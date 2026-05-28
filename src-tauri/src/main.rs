#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const SCHEMA_SQL: &str = include_str!("../db/schema.sql");

struct AppState {
    db_path: PathBuf,
    attachments_dir: PathBuf,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    id: String,
    snippet_id: String,
    file_path: String,
    mime_type: String,
    width: Option<i64>,
    height: Option<i64>,
    created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Tag {
    id: String,
    name: String,
    normalized_name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Snippet {
    id: String,
    title: String,
    code: String,
    language: String,
    code_blocks: Vec<SnippetCodeBlock>,
    note: String,
    tags: Vec<Tag>,
    attachments: Vec<Attachment>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnippetCodeBlock {
    id: String,
    language: String,
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSnippetInput {
    title: String,
    code_blocks: Vec<SnippetCodeBlock>,
    note: String,
    tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSnippetInput {
    title: String,
    code_blocks: Vec<SnippetCodeBlock>,
    note: String,
    tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchSnippetsInput {
    query: String,
    tags: Vec<String>,
    sort: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardAttachmentDraft {
    draft_id: String,
    file_name: String,
    mime_type: String,
    bytes_base64: String,
    width: Option<i64>,
    height: Option<i64>,
}

struct DbLock(Mutex<()>);

fn normalize_tag_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{now}")
}

fn generate_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4())
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(db_path).map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(SCHEMA_SQL)
        .map_err(|error| error.to_string())?;
    migrate_schema(&connection)?;
    Ok(connection)
}

fn migrate_schema(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(snippets)")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    let columns = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    if !columns.iter().any(|column| column == "code_blocks") {
        connection
            .execute(
                "ALTER TABLE snippets ADD COLUMN code_blocks TEXT NOT NULL DEFAULT '[]'",
                [],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn default_language() -> String {
    "TypeScript".to_string()
}

fn normalize_code_blocks(
    code_blocks: Option<Vec<SnippetCodeBlock>>,
    fallback_language: &str,
    fallback_code: &str,
) -> Vec<SnippetCodeBlock> {
    match code_blocks {
        Some(blocks) if !blocks.is_empty() => blocks
            .into_iter()
            .enumerate()
            .map(|(index, block)| SnippetCodeBlock {
                id: if block.id.trim().is_empty() {
                    format!("block-{}", index + 1)
                } else {
                    block.id
                },
                language: if block.language.trim().is_empty() {
                    fallback_language.to_string()
                } else {
                    block.language
                },
                code: block.code,
            })
            .collect(),
        _ => vec![SnippetCodeBlock {
            id: "block-1".to_string(),
            language: if fallback_language.trim().is_empty() {
                default_language()
            } else {
                fallback_language.to_string()
            },
            code: fallback_code.to_string(),
        }],
    }
}

fn load_tags(connection: &Connection, snippet_id: &str) -> Result<Vec<Tag>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT tags.id, tags.name, tags.normalized_name
            FROM tags
            INNER JOIN snippet_tags ON snippet_tags.tag_id = tags.id
            WHERE snippet_tags.snippet_id = ?1
            ORDER BY tags.name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([snippet_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                normalized_name: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_attachments(connection: &Connection, snippet_id: &str) -> Result<Vec<Attachment>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, snippet_id, file_path, mime_type, width, height, created_at
            FROM attachments
            WHERE snippet_id = ?1
            ORDER BY created_at DESC
            "#,
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([snippet_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                snippet_id: row.get(1)?,
                file_path: row.get(2)?,
                mime_type: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_snippet(connection: &Connection, snippet_id: &str) -> Result<Snippet, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, title, code, language, note, created_at, updated_at
                 , code_blocks
            FROM snippets
            WHERE id = ?1
            "#,
        )
        .map_err(|error| error.to_string())?;

    let snippet = statement
        .query_row([snippet_id], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                title: row.get(1)?,
                code: row.get(2)?,
                language: row.get(3)?,
                note: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                code_blocks: normalize_code_blocks(
                    serde_json::from_str::<Vec<SnippetCodeBlock>>(&row.get::<_, String>(7)?).ok(),
                    &row.get::<_, String>(3)?,
                    &row.get::<_, String>(2)?,
                ),
                tags: Vec::new(),
                attachments: Vec::new(),
            })
        })
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Snippet not found".to_string())?;

    Ok(Snippet {
        tags: load_tags(connection, snippet_id)?,
        attachments: load_attachments(connection, snippet_id)?,
        ..snippet
    })
}

fn upsert_tags(
    connection: &Connection,
    snippet_id: &str,
    raw_tags: &[String],
) -> Result<Vec<Tag>, String> {
    connection
        .execute("DELETE FROM snippet_tags WHERE snippet_id = ?1", [snippet_id])
        .map_err(|error| error.to_string())?;

    let mut seen = std::collections::HashSet::new();
    let mut tags = Vec::new();

    for name in raw_tags
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let normalized_name = normalize_tag_name(name);
        if !seen.insert(normalized_name.clone()) {
            continue;
        }

        let existing = connection
            .query_row(
                "SELECT id, name, normalized_name FROM tags WHERE normalized_name = ?1",
                [normalized_name.as_str()],
                |row| {
                    Ok(Tag {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        normalized_name: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;

        let tag = if let Some(tag) = existing {
            connection
                .execute(
                    "UPDATE tags SET name = ?1 WHERE id = ?2",
                    params![name, tag.id.as_str()],
                )
                .map_err(|error| error.to_string())?;
            Tag {
                name: name.to_string(),
                ..tag
            }
        } else {
            let tag = Tag {
                id: generate_id("tag"),
                name: name.to_string(),
                normalized_name: normalized_name.clone(),
            };
            connection
                .execute(
                    "INSERT INTO tags (id, name, normalized_name) VALUES (?1, ?2, ?3)",
                    params![tag.id.as_str(), tag.name.as_str(), tag.normalized_name.as_str()],
                )
                .map_err(|error| error.to_string())?;
            tag
        };

        connection
            .execute(
                "INSERT INTO snippet_tags (snippet_id, tag_id) VALUES (?1, ?2)",
                params![snippet_id, tag.id.as_str()],
            )
            .map_err(|error| error.to_string())?;

        tags.push(tag);
    }

    tags.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(tags)
}

fn search_snippets_inner(connection: &Connection, input: &SearchSnippetsInput) -> Result<Vec<Snippet>, String> {
    let order_column = match input.sort.as_str() {
        "createdAt" => "created_at",
        _ => "updated_at",
    };

    let mut statement = connection
        .prepare(&format!(
            "SELECT id, title, code, language, note, created_at, updated_at, code_blocks FROM snippets ORDER BY {order_column} DESC"
        ))
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Snippet {
                id: row.get(0)?,
                title: row.get(1)?,
                code: row.get(2)?,
                language: row.get(3)?,
                note: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                code_blocks: normalize_code_blocks(
                    serde_json::from_str::<Vec<SnippetCodeBlock>>(&row.get::<_, String>(7)?).ok(),
                    &row.get::<_, String>(3)?,
                    &row.get::<_, String>(2)?,
                ),
                tags: Vec::new(),
                attachments: Vec::new(),
            })
        })
        .map_err(|error| error.to_string())?;

    let query = input.query.trim().to_lowercase();
    let selected_tags = input
        .tags
        .iter()
        .map(|tag| normalize_tag_name(tag))
        .collect::<Vec<_>>();

    let mut snippets = Vec::new();
    for row in rows {
        let mut snippet = row.map_err(|error| error.to_string())?;
        snippet.tags = load_tags(connection, &snippet.id)?;
        snippet.attachments = load_attachments(connection, &snippet.id)?;

        let haystack = format!(
            "{}\n{}\n{}\n{}",
            snippet.title,
            snippet
                .code_blocks
                .iter()
                .map(|block| format!("{}\n{}", block.language, block.code))
                .collect::<Vec<_>>()
                .join("\n"),
            snippet.note,
            snippet
                .tags
                .iter()
                .map(|tag| tag.name.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        )
        .to_lowercase();

        let matches_query = query.is_empty() || haystack.contains(&query);
        let matches_tags = selected_tags.is_empty()
            || selected_tags.iter().all(|selected| {
                snippet
                    .tags
                    .iter()
                    .any(|tag| &tag.normalized_name == selected)
            });

        if matches_query && matches_tags {
            snippets.push(snippet);
        }
    }

    Ok(snippets)
}

fn detect_extension(mime_type: &str, file_name: &str) -> &str {
    if let Some((_, extension)) = file_name.rsplit_once('.') {
        return extension;
    }

    match mime_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    }
}

#[tauri::command]
fn create_snippet(
    input: CreateSnippetInput,
    state: State<'_, AppState>,
    db_lock: State<'_, DbLock>,
) -> Result<Snippet, String> {
    let _guard = db_lock.0.lock().map_err(|error| error.to_string())?;
    let connection = open_connection(&state.db_path)?;
    let id = generate_id("snippet");
    let now = now_iso();
    let title = if input.title.trim().is_empty() {
        "Untitled Snippet".to_string()
    } else {
        input.title.trim().to_string()
    };
    let code_blocks = normalize_code_blocks(Some(input.code_blocks), &default_language(), "");
    let primary = code_blocks
        .first()
        .cloned()
        .unwrap_or(SnippetCodeBlock {
            id: "block-1".to_string(),
            language: default_language(),
            code: String::new(),
        });
    let code_blocks_json =
        serde_json::to_string(&code_blocks).map_err(|error| error.to_string())?;

    connection
        .execute(
            r#"
            INSERT INTO snippets (id, title, code, language, code_blocks, note, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                id.as_str(),
                title.as_str(),
                primary.code.as_str(),
                primary.language.as_str(),
                code_blocks_json.as_str(),
                input.note.as_str(),
                now.as_str(),
                now.as_str()
            ],
        )
        .map_err(|error| error.to_string())?;

    upsert_tags(&connection, &id, &input.tags)?;
    load_snippet(&connection, &id)
}

#[tauri::command]
fn update_snippet(
    id: String,
    input: UpdateSnippetInput,
    state: State<'_, AppState>,
    db_lock: State<'_, DbLock>,
) -> Result<Snippet, String> {
    let _guard = db_lock.0.lock().map_err(|error| error.to_string())?;
    let connection = open_connection(&state.db_path)?;
    let current = load_snippet(&connection, &id)?;
    let title = if input.title.trim().is_empty() {
        "Untitled Snippet".to_string()
    } else {
        input.title.trim().to_string()
    };
    let code_blocks = normalize_code_blocks(Some(input.code_blocks), &current.language, &current.code);
    let primary = code_blocks
        .first()
        .cloned()
        .unwrap_or(SnippetCodeBlock {
            id: "block-1".to_string(),
            language: current.language.clone(),
            code: current.code.clone(),
        });
    let code_blocks_json =
        serde_json::to_string(&code_blocks).map_err(|error| error.to_string())?;

    connection
        .execute(
            r#"
            UPDATE snippets
            SET title = ?1, code = ?2, language = ?3, code_blocks = ?4, note = ?5, created_at = ?6, updated_at = ?7
            WHERE id = ?8
            "#,
            params![
                title.as_str(),
                primary.code.as_str(),
                primary.language.as_str(),
                code_blocks_json.as_str(),
                input.note.as_str(),
                current.created_at.as_str(),
                now_iso(),
                id.as_str()
            ],
        )
        .map_err(|error| error.to_string())?;

    upsert_tags(&connection, &id, &input.tags)?;
    load_snippet(&connection, &id)
}

#[tauri::command]
fn search_snippets(
    input: SearchSnippetsInput,
    state: State<'_, AppState>,
    db_lock: State<'_, DbLock>,
) -> Result<Vec<Snippet>, String> {
    let _guard = db_lock.0.lock().map_err(|error| error.to_string())?;
    let connection = open_connection(&state.db_path)?;
    search_snippets_inner(&connection, &input)
}

#[tauri::command]
fn list_tags(
    keyword: String,
    state: State<'_, AppState>,
    db_lock: State<'_, DbLock>,
) -> Result<Vec<Tag>, String> {
    let _guard = db_lock.0.lock().map_err(|error| error.to_string())?;
    let connection = open_connection(&state.db_path)?;
    let normalized_keyword = normalize_tag_name(&keyword);
    let mut statement = connection
        .prepare(
            "SELECT id, name, normalized_name FROM tags ORDER BY name COLLATE NOCASE ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                normalized_name: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut tags = Vec::new();
    for row in rows {
        let tag = row.map_err(|error| error.to_string())?;
        if normalized_keyword.is_empty() || tag.normalized_name.contains(&normalized_keyword) {
            tags.push(tag);
        }
    }

    Ok(tags)
}

#[tauri::command]
fn attach_image_from_clipboard(
    draft: ClipboardAttachmentDraft,
    snippet_id: String,
    state: State<'_, AppState>,
    db_lock: State<'_, DbLock>,
) -> Result<Snippet, String> {
    let _guard = db_lock.0.lock().map_err(|error| error.to_string())?;
    let connection = open_connection(&state.db_path)?;
    let _ = load_snippet(&connection, &snippet_id)?;

    let attachment_id = generate_id("attachment");
    let extension = detect_extension(&draft.mime_type, &draft.file_name);
    let snippet_dir = state.attachments_dir.join(&snippet_id);
    fs::create_dir_all(&snippet_dir).map_err(|error| error.to_string())?;

    let file_name = format!("{attachment_id}.{extension}");
    let file_path = snippet_dir.join(file_name);
    let bytes = BASE64
        .decode(draft.bytes_base64.as_bytes())
        .map_err(|error| error.to_string())?;
    fs::write(&file_path, bytes).map_err(|error| error.to_string())?;

    let created_at = now_iso();
    connection
        .execute(
            r#"
            INSERT INTO attachments (id, snippet_id, file_path, mime_type, width, height, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                attachment_id.as_str(),
                snippet_id.as_str(),
                file_path.to_string_lossy().as_ref(),
                draft.mime_type.as_str(),
                draft.width,
                draft.height,
                created_at.as_str()
            ],
        )
        .map_err(|error| error.to_string())?;

    connection
        .execute(
            "UPDATE snippets SET updated_at = ?1 WHERE id = ?2",
            params![created_at.as_str(), snippet_id.as_str()],
        )
        .map_err(|error| error.to_string())?;

    load_snippet(&connection, &snippet_id)
}

#[tauri::command]
fn read_attachment_base64(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let allowed_root = state
        .attachments_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;

    if !canonical.starts_with(&allowed_root) {
        return Err("Attachment path is outside the application data directory".to_string());
    }

    let bytes = fs::read(canonical).map_err(|error| error.to_string())?;
    Ok(BASE64.encode(bytes))
}

fn app_state(app: &AppHandle) -> Result<AppState, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    let attachments_dir = app_data_dir.join("attachments");
    fs::create_dir_all(&attachments_dir).map_err(|error| error.to_string())?;

    let db_path = app_data_dir.join("codestock.sqlite");
    let _ = open_connection(&db_path)?;

    Ok(AppState {
        db_path,
        attachments_dir,
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let state = app_state(app.handle()).map_err(std::io::Error::other)?;
            app.manage(state);
            app.manage(DbLock(Mutex::new(())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_snippet,
            update_snippet,
            search_snippets,
            list_tags,
            attach_image_from_clipboard,
            read_attachment_base64
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeStock");
}
