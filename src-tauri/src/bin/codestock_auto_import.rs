use rusqlite::{params, Connection};
use serde::Serialize;
use std::{
    collections::HashSet,
    env,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const SCHEMA_SQL: &str = include_str!("../../db/schema.sql");
const DEFAULT_APP_IDENTIFIER: &str = "com.codestock.app";

#[derive(Debug)]
struct CliOptions {
    project_dir: PathBuf,
    db_path: Option<PathBuf>,
}

#[derive(Debug)]
struct ScssSection {
    selector: String,
    class_name: String,
    code: String,
    scss_path: PathBuf,
}

#[derive(Debug)]
struct EjsMatch {
    path: PathBuf,
    code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnippetCodeBlock {
    id: String,
    language: String,
    code: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let options = if args.is_empty() {
        prompt_options()?
    } else {
        parse_args(args)?
    };
    let project_dir = canonicalize_existing_dir(&options.project_dir, "Project folder")?;
    let db_path = match options.db_path {
        Some(path) => path,
        None => default_db_path()?,
    };

    let scss_files = find_named_files(&project_dir, "_custom.scss")?;
    if scss_files.is_empty() {
        return Err(format!(
            "_custom.scss was not found under {}",
            project_dir.display()
        ));
    }

    let ejs_files = ordered_ejs_files(&project_dir)?;
    if ejs_files.is_empty() {
        return Err(format!("No .ejs files were found under {}", project_dir.display()));
    }

    let connection = open_connection(&db_path)?;
    let project_tag = project_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("project")
        .to_string();

    let mut created = 0usize;
    let mut skipped = Vec::new();

    for scss_path in scss_files {
        let source = fs::read_to_string(&scss_path)
            .map_err(|error| format!("Could not read {}: {error}", scss_path.display()))?;
        let sections = parse_scss_sections(&source, scss_path.clone());

        for section in sections {
            match find_ejs_section(&ejs_files, &section.class_name) {
                Ok(Some(ejs_match)) => {
                    insert_snippet(
                        &connection,
                        &project_dir,
                        &project_tag,
                        &section,
                        &ejs_match,
                    )?;
                    created += 1;
                    println!(
                        "created {} from {} and {}",
                        section.selector,
                        relative_display(&project_dir, &section.scss_path),
                        relative_display(&project_dir, &ejs_match.path)
                    );
                }
                Ok(None) => {
                    skipped.push(format!("{}: matching EJS section not found", section.selector));
                }
                Err(error) => {
                    skipped.push(format!("{}: {error}", section.selector));
                }
            }
        }
    }

    println!("Done. created={created}, skipped={}", skipped.len());
    for item in skipped {
        println!("skipped {item}");
    }

    Ok(())
}

fn parse_args(args: Vec<String>) -> Result<CliOptions, String> {
    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        return Err(
            "Usage: cargo run --bin codestock_auto_import -- <project-folder> [--db <codestock.sqlite>]"
                .to_string(),
        );
    }

    let mut project_dir = None;
    let mut db_path = None;
    let mut index = 0usize;

    while index < args.len() {
        match args[index].as_str() {
            "--db" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--db requires a path".to_string())?;
                db_path = Some(PathBuf::from(value));
            }
            value if value.starts_with("--") => {
                return Err(format!("Unknown option: {value}"));
            }
            value => {
                if project_dir.is_some() {
                    return Err(format!("Unexpected extra argument: {value}"));
                }
                project_dir = Some(PathBuf::from(value));
            }
        }
        index += 1;
    }

    Ok(CliOptions {
        project_dir: project_dir.ok_or_else(|| "Project folder is required".to_string())?,
        db_path,
    })
}

fn prompt_options() -> Result<CliOptions, String> {
    println!("CodeStock auto import");
    println!("対象プロジェクトフォルダのパスを入力してください。");

    let project_dir = loop {
        let input = prompt("Project folder path: ")?;
        if input.trim().is_empty() {
            println!("Project folder path is required.");
            continue;
        }
        break PathBuf::from(clean_prompt_path(&input));
    };

    println!("CodeStock DB path は空欄で自動検出します。");
    let db_input = prompt("DB path (optional): ")?;
    let db_path = if db_input.trim().is_empty() {
        None
    } else {
        Some(PathBuf::from(clean_prompt_path(&db_input)))
    };

    Ok(CliOptions {
        project_dir,
        db_path,
    })
}

fn prompt(label: &str) -> Result<String, String> {
    print!("{label}");
    io::stdout()
        .flush()
        .map_err(|error| format!("Could not flush stdout: {error}"))?;

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .map_err(|error| format!("Could not read input: {error}"))?;
    Ok(input.trim().to_string())
}

fn clean_prompt_path(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn canonicalize_existing_dir(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("{label} does not exist: {} ({error})", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{label} is not a directory: {}", canonical.display()));
    }
    Ok(canonical)
}

fn default_db_path() -> Result<PathBuf, String> {
    if let Ok(explicit) = env::var("CODESTOCK_DB") {
        return Ok(PathBuf::from(explicit));
    }

    #[cfg(target_os = "windows")]
    {
        let app_data = env::var_os("APPDATA")
            .ok_or_else(|| "APPDATA is not set. Pass --db <codestock.sqlite>.".to_string())?;
        return Ok(PathBuf::from(app_data)
            .join(DEFAULT_APP_IDENTIFIER)
            .join("codestock.sqlite"));
    }

    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME")
            .ok_or_else(|| "HOME is not set. Pass --db <codestock.sqlite>.".to_string())?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(DEFAULT_APP_IDENTIFIER)
            .join("codestock.sqlite"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(data_home) = env::var("XDG_DATA_HOME") {
            return Ok(PathBuf::from(data_home)
                .join(DEFAULT_APP_IDENTIFIER)
                .join("codestock.sqlite"));
        }

        let home = env::var_os("HOME")
            .ok_or_else(|| "HOME is not set. Pass --db <codestock.sqlite>.".to_string())?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(DEFAULT_APP_IDENTIFIER)
            .join("codestock.sqlite"))
    }
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create DB directory {}: {error}", parent.display()))?;
    }

    let connection = Connection::open(db_path)
        .map_err(|error| format!("Could not open database {}: {error}", db_path.display()))?;
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

fn insert_snippet(
    connection: &Connection,
    project_dir: &Path,
    project_tag: &str,
    section: &ScssSection,
    ejs_match: &EjsMatch,
) -> Result<(), String> {
    let id = generate_id("snippet");
    let now = now_iso();
    let code_blocks = vec![
        SnippetCodeBlock {
            id: generate_id("block"),
            language: "SCSS".to_string(),
            code: section.code.clone(),
        },
        SnippetCodeBlock {
            id: generate_id("block"),
            language: "HTML".to_string(),
            code: ejs_match.code.clone(),
        },
    ];
    let code_blocks_json =
        serde_json::to_string(&code_blocks).map_err(|error| error.to_string())?;
    let note = format!(
        "Auto imported from project: {}\nSCSS: {}\nEJS: {}\nSelector: {}",
        project_dir.display(),
        relative_display(project_dir, &section.scss_path),
        relative_display(project_dir, &ejs_match.path),
        section.selector
    );

    connection
        .execute(
            r#"
            INSERT INTO snippets (id, title, code, language, code_blocks, note, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                id.as_str(),
                section.selector.as_str(),
                section.code.as_str(),
                "SCSS",
                code_blocks_json.as_str(),
                note.as_str(),
                now.as_str(),
                now.as_str()
            ],
        )
        .map_err(|error| error.to_string())?;

    upsert_tags(
        connection,
        &id,
        &[
            "auto-import".to_string(),
            "scss-section".to_string(),
            project_tag.to_string(),
            section.class_name.clone(),
        ],
    )
}

fn upsert_tags(connection: &Connection, snippet_id: &str, tag_names: &[String]) -> Result<(), String> {
    let mut seen = HashSet::new();

    for name in tag_names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized = trimmed.to_lowercase();
        if !seen.insert(normalized.clone()) {
            continue;
        }

        let tag_id = generate_id("tag");
        connection
            .execute(
                r#"
                INSERT INTO tags (id, name, normalized_name)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name
                "#,
                params![tag_id.as_str(), trimmed, normalized.as_str()],
            )
            .map_err(|error| error.to_string())?;

        let stored_tag_id = connection
            .query_row(
                "SELECT id FROM tags WHERE normalized_name = ?1",
                [normalized.as_str()],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?;

        connection
            .execute(
                "INSERT OR IGNORE INTO snippet_tags (snippet_id, tag_id) VALUES (?1, ?2)",
                params![snippet_id, stored_tag_id.as_str()],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn find_named_files(root: &Path, file_name: &str) -> Result<Vec<PathBuf>, String> {
    let mut found = Vec::new();
    walk_files(root, &mut |path| {
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(file_name))
        {
            found.push(path.to_path_buf());
        }
    })?;
    found.sort();
    Ok(found)
}

fn ordered_ejs_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut all = Vec::new();
    walk_files(root, &mut |path| {
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("ejs"))
        {
            all.push(path.to_path_buf());
        }
    })?;
    all.sort();

    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    for path in [root.join("page").join("index.ejs"), root.join("page").join("footer.ejs")] {
        push_unique_existing(&mut ordered, &mut seen, path);
    }

    for file_name in ["index.ejs", "footer.ejs"] {
        for path in &all {
            if is_inside_page_dir(path, file_name) {
                push_unique_existing(&mut ordered, &mut seen, path.clone());
            }
        }
    }

    for path in all {
        push_unique_existing(&mut ordered, &mut seen, path);
    }

    Ok(ordered)
}

fn push_unique_existing(ordered: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, path: PathBuf) {
    if !path.exists() {
        return;
    }
    let canonical = fs::canonicalize(&path).unwrap_or(path);
    if seen.insert(canonical.clone()) {
        ordered.push(canonical);
    }
}

fn is_inside_page_dir(path: &Path, file_name: &str) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(file_name))
        && path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("page"))
}

fn walk_files(root: &Path, callback: &mut dyn FnMut(&Path)) -> Result<(), String> {
    if should_skip_dir(root) {
        return Ok(());
    }

    for entry in fs::read_dir(root).map_err(|error| format!("Could not read {}: {error}", root.display()))? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            if !should_skip_dir(&path) {
                walk_files(&path, callback)?;
            }
        } else if file_type.is_file() {
            callback(&path);
        }
    }

    Ok(())
}

fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| {
            matches!(
                name,
                ".git" | ".svn" | ".hg" | "node_modules" | "dist" | "target" | ".next"
            )
        })
}

fn parse_scss_sections(source: &str, scss_path: PathBuf) -> Vec<ScssSection> {
    let bytes = source.as_bytes();
    let mut sections = Vec::new();
    let mut depth = 0usize;
    let mut statement_start = 0usize;
    let mut block_start = 0usize;
    let mut block_open = 0usize;
    let mut index = 0usize;
    let mut state = ScanState::Code;

    while index < bytes.len() {
        match state {
            ScanState::Code => {
                if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'/') {
                    state = ScanState::LineComment;
                    index += 2;
                    continue;
                }
                if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'*') {
                    state = ScanState::BlockComment;
                    index += 2;
                    continue;
                }
                if bytes[index] == b'\'' || bytes[index] == b'"' {
                    state = ScanState::String(bytes[index]);
                    index += 1;
                    continue;
                }
                if bytes[index] == b';' && depth == 0 {
                    statement_start = index + 1;
                } else if bytes[index] == b'{' {
                    if depth == 0 {
                        block_start = trim_scss_trivia(source, statement_start, index);
                        block_open = index;
                    }
                    depth += 1;
                } else if bytes[index] == b'}' && depth > 0 {
                    depth -= 1;
                    if depth == 0 {
                        let selector = source[block_start..find_selector_end(source, block_start, block_open)]
                            .trim()
                            .to_string();
                        if let Some(class_name) = first_class_selector(&selector) {
                            sections.push(ScssSection {
                                selector,
                                class_name,
                                code: source[block_start..=index].trim().to_string(),
                                scss_path: scss_path.clone(),
                            });
                        }
                        statement_start = index + 1;
                    }
                }
            }
            ScanState::LineComment => {
                if bytes[index] == b'\n' {
                    state = ScanState::Code;
                }
            }
            ScanState::BlockComment => {
                if bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/') {
                    state = ScanState::Code;
                    index += 2;
                    continue;
                }
            }
            ScanState::String(quote) => {
                if bytes[index] == b'\\' {
                    index += 2;
                    continue;
                }
                if bytes[index] == quote {
                    state = ScanState::Code;
                }
            }
        }
        index += 1;
    }

    sections
}

#[derive(Clone, Copy)]
enum ScanState {
    Code,
    LineComment,
    BlockComment,
    String(u8),
}

fn trim_scss_trivia(source: &str, mut index: usize, limit: usize) -> usize {
    let bytes = source.as_bytes();

    while index < limit {
        while index < limit && bytes[index].is_ascii_whitespace() {
            index += 1;
        }

        if index + 1 < limit && bytes[index] == b'/' && bytes[index + 1] == b'/' {
            index += 2;
            while index < limit && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }

        if index + 1 < limit && bytes[index] == b'/' && bytes[index + 1] == b'*' {
            index += 2;
            while index + 1 < limit && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 2).min(limit);
            continue;
        }

        break;
    }

    index
}

fn find_selector_end(source: &str, start: usize, open_brace: usize) -> usize {
    let mut end = open_brace;
    while end > start && source.as_bytes()[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    end
}

fn first_class_selector(selector: &str) -> Option<String> {
    for part in selector.split(',') {
        let trimmed = part.trim();
        let bytes = trimmed.as_bytes();
        if bytes.first() != Some(&b'.') || bytes.get(1).is_none_or(|value| !is_class_start(*value))
        {
            continue;
        }

        let mut end = 2usize;
        while end < bytes.len() && is_class_continue(bytes[end]) {
            end += 1;
        }
        if end > 1 {
            return Some(trimmed[1..end].to_string());
        }
    }

    None
}

fn is_class_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_' || value == b'-'
}

fn is_class_continue(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'-'
}

fn find_ejs_section(ejs_files: &[PathBuf], class_name: &str) -> Result<Option<EjsMatch>, String> {
    for path in ejs_files {
        let source = fs::read_to_string(path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        if let Some(code) = extract_html_section(&source, class_name)? {
            return Ok(Some(EjsMatch {
                path: path.clone(),
                code,
            }));
        }
    }
    Ok(None)
}

fn extract_html_section(source: &str, class_name: &str) -> Result<Option<String>, String> {
    let mut search_start = 0usize;
    while let Some(found) = source[search_start..].find(class_name) {
        let class_pos = search_start + found;
        search_start = class_pos + class_name.len();

        let Some(tag_start) = source[..class_pos].rfind('<') else {
            continue;
        };
        if source[tag_start..class_pos].contains('>') {
            continue;
        }
        let Some(tag_end) = source[class_pos..].find('>').map(|offset| class_pos + offset) else {
            continue;
        };

        let opening_tag = &source[tag_start..=tag_end];
        if !class_attribute_contains(opening_tag, class_name) {
            continue;
        }

        let Some(tag_name) = parse_opening_tag_name(opening_tag) else {
            continue;
        };

        if is_self_closing(opening_tag) || is_void_tag(&tag_name) {
            return Ok(Some(opening_tag.trim().to_string()));
        }

        let Some(close_end) = find_matching_close(source, tag_end + 1, &tag_name) else {
            return Err(format!("closing </{tag_name}> was not found"));
        };

        return Ok(Some(source[tag_start..close_end].trim().to_string()));
    }

    Ok(None)
}

fn class_attribute_contains(opening_tag: &str, class_name: &str) -> bool {
    let lower = opening_tag.to_ascii_lowercase();
    let bytes = opening_tag.as_bytes();
    let mut index = 0usize;

    while let Some(found) = lower[index..].find("class") {
        let class_index = index + found;
        let before = if class_index == 0 {
            b' '
        } else {
            bytes[class_index - 1]
        };
        let after_index = class_index + "class".len();
        let after = bytes.get(after_index).copied().unwrap_or(b' ');

        if !is_attr_boundary(before) || !is_attr_boundary(after) {
            index = after_index;
            continue;
        }

        let mut cursor = after_index;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if bytes.get(cursor) != Some(&b'=') {
            index = cursor;
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        let Some(quote) = bytes.get(cursor).copied() else {
            return false;
        };
        if quote != b'\'' && quote != b'"' {
            return false;
        }
        cursor += 1;
        let value_start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if cursor > value_start {
            let value = &opening_tag[value_start..cursor];
            if value.split_whitespace().any(|item| item == class_name) {
                return true;
            }
        }
        index = cursor.saturating_add(1);
    }

    false
}

fn is_attr_boundary(value: u8) -> bool {
    value.is_ascii_whitespace() || value == b'<' || value == b'/' || value == b'>' || value == b'='
}

fn parse_opening_tag_name(opening_tag: &str) -> Option<String> {
    let bytes = opening_tag.as_bytes();
    if bytes.first() != Some(&b'<') {
        return None;
    }
    let mut index = 1usize;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if matches!(bytes.get(index), Some(b'/') | Some(b'!') | Some(b'?') | Some(b'%')) {
        return None;
    }
    let start = index;
    while index < bytes.len()
        && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'-' || bytes[index] == b':')
    {
        index += 1;
    }
    if index == start {
        return None;
    }
    Some(opening_tag[start..index].to_ascii_lowercase())
}

fn find_matching_close(source: &str, start: usize, tag_name: &str) -> Option<usize> {
    let mut depth = 1usize;
    let mut cursor = start;

    while let Some(found) = source[cursor..].find('<') {
        let tag_start = cursor + found;
        if source[tag_start..].starts_with("<!--") {
            cursor = source[tag_start + 4..]
                .find("-->")
                .map(|offset| tag_start + 4 + offset + 3)
                .unwrap_or(source.len());
            continue;
        }
        if source[tag_start..].starts_with("<%") {
            cursor = source[tag_start + 2..]
                .find("%>")
                .map(|offset| tag_start + 2 + offset + 2)
                .unwrap_or(source.len());
            continue;
        }

        let Some(tag_end) = source[tag_start..].find('>').map(|offset| tag_start + offset + 1) else {
            return None;
        };
        let tag = &source[tag_start..tag_end];
        if is_closing_tag(tag, tag_name) {
            depth -= 1;
            if depth == 0 {
                return Some(tag_end);
            }
        } else if parse_opening_tag_name(tag).as_deref() == Some(tag_name)
            && !is_self_closing(tag)
            && !is_void_tag(tag_name)
        {
            depth += 1;
        }
        cursor = tag_end;
    }

    None
}

fn is_closing_tag(tag: &str, tag_name: &str) -> bool {
    let bytes = tag.as_bytes();
    if !tag.starts_with("</") {
        return false;
    }
    let mut index = 2usize;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    let start = index;
    while index < bytes.len()
        && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'-' || bytes[index] == b':')
    {
        index += 1;
    }
    tag[start..index].eq_ignore_ascii_case(tag_name)
}

fn is_self_closing(tag: &str) -> bool {
    tag.trim_end().ends_with("/>")
}

fn is_void_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
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

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_top_level_scss_sections() {
        let source = r#"
@charset "utf-8";
.sec_one {
  color: red;
  .child { color: blue; }
}

@media (max-width: 767px) {
  .ignored { color: green; }
}

.sec_two {
  background: url("{}");
}
"#;

        let sections = parse_scss_sections(source, PathBuf::from("_custom.scss"));
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].selector, ".sec_one");
        assert_eq!(sections[0].class_name, "sec_one");
        assert!(sections[0].code.contains(".child"));
        assert_eq!(sections[1].selector, ".sec_two");
    }

    #[test]
    fn extracts_matching_ejs_element() {
        let source = r#"
<main>
  <section class="foo sec_one bar">
    <div><span>content</span></div>
  </section>
</main>
"#;

        let extracted = extract_html_section(source, "sec_one").unwrap().unwrap();
        assert!(extracted.starts_with("<section"));
        assert!(extracted.ends_with("</section>"));
        assert!(extracted.contains("<span>content</span>"));
    }

    #[test]
    fn class_matching_uses_whole_class_tokens() {
        let source = r#"<section class="sec_one_more"></section><section class="sec_one"></section>"#;
        let extracted = extract_html_section(source, "sec_one").unwrap().unwrap();
        assert_eq!(extracted, r#"<section class="sec_one"></section>"#);
    }
}
