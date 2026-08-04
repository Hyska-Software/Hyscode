use crate::{App, Interaction, ProjectSummary, SessionSummary, TranscriptItem, TranscriptKind};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::Frame;

const BACKGROUND: Color = Color::Rgb(15, 17, 21);
const SURFACE: Color = Color::Rgb(22, 25, 30);
const SURFACE_RAISED: Color = Color::Rgb(31, 35, 42);
const BORDER: Color = Color::Rgb(54, 61, 71);
const MUTED: Color = Color::Rgb(132, 142, 155);
const TEXT: Color = Color::Rgb(224, 229, 235);
const ACCENT: Color = Color::Rgb(111, 196, 173);
const WARNING: Color = Color::Rgb(224, 177, 105);
const ERROR: Color = Color::Rgb(220, 112, 118);
const SUCCESS: Color = Color::Rgb(133, 201, 139);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Focus {
    Composer,
    Sidebar,
    Transcript,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Overlay {
    None,
    Help,
    CommandPalette,
    SessionList,
    ProjectList,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CommandFlow {
    Root {
        selected: usize,
    },
    Mode {
        selected: usize,
    },
    Provider {
        selected: usize,
    },
    Model {
        provider_index: usize,
        selected: usize,
    },
    Thinking {
        selected: usize,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CommandSpec {
    pub(crate) name: &'static str,
    pub(crate) description: &'static str,
    pub(crate) usage: &'static str,
}

pub(crate) const SIDEBAR_ACTIONS: [(&str, &str); 6] = [
    ("New session", "N"),
    ("Saved sessions", "S"),
    ("Projects", "P"),
    ("Diagnostics", "D"),
    ("Retry last turn", "R"),
    ("Help and shortcuts", "F1"),
];

pub(crate) const MODE_OPTIONS: [(&str, &str); 5] = [
    ("chat", "Discuss, explain, and answer without editing files"),
    ("build", "Implement changes and run the required tools"),
    (
        "review",
        "Inspect the workspace and report actionable findings",
    ),
    ("debug", "Trace failures and test focused fixes"),
    (
        "plan",
        "Create an implementation plan without changing files",
    ),
];

const COMMANDS: [CommandSpec; 16] = [
    CommandSpec {
        name: "/help",
        description: "Open the keyboard and command reference",
        usage: "/help",
    },
    CommandSpec {
        name: "/mode",
        description: "Change the active agent mode",
        usage: "/mode <chat|build|review|debug|plan>",
    },
    CommandSpec {
        name: "/thinking",
        description: "Change thinking effort for the active model",
        usage: "/thinking",
    },
    CommandSpec {
        name: "/model",
        description: "Select a provider and model",
        usage: "/model <provider> <model>",
    },
    CommandSpec {
        name: "/models",
        description: "Select a provider and model",
        usage: "/models",
    },
    CommandSpec {
        name: "/new",
        description: "Start a clean session in this workspace",
        usage: "/new",
    },
    CommandSpec {
        name: "/sessions",
        description: "Browse and load saved sessions",
        usage: "/sessions",
    },
    CommandSpec {
        name: "/projects",
        description: "Browse known workspaces",
        usage: "/projects",
    },
    CommandSpec {
        name: "/project",
        description: "Switch to a workspace path",
        usage: "/project <path>",
    },
    CommandSpec {
        name: "/load",
        description: "Load a session by id",
        usage: "/load <session-id>",
    },
    CommandSpec {
        name: "/diagnostics",
        description: "Inspect workspace or file diagnostics",
        usage: "/diagnostics [path]",
    },
    CommandSpec {
        name: "/retry",
        description: "Run the previous user message again",
        usage: "/retry",
    },
    CommandSpec {
        name: "/cancel",
        description: "Stop the active agent turn",
        usage: "/cancel",
    },
    CommandSpec {
        name: "/clear",
        description: "Clear the visible conversation",
        usage: "/clear",
    },
    CommandSpec {
        name: "/quit",
        description: "Close the TUI",
        usage: "/quit",
    },
    CommandSpec {
        name: "/exit",
        description: "Close the TUI",
        usage: "/exit",
    },
];

pub(crate) fn matching_commands(input: &str) -> Vec<CommandSpec> {
    if !input.starts_with('/') || input.contains(char::is_whitespace) {
        return Vec::new();
    }
    let normalized = input.to_ascii_lowercase();
    COMMANDS
        .iter()
        .copied()
        .filter(|command| command.name.starts_with(normalized.as_str()))
        .collect()
}

pub(crate) fn command_palette_items(input: &str) -> Vec<CommandSpec> {
    matching_commands(input)
}

pub(crate) fn next_focus(current: Focus, wide_layout: bool) -> Focus {
    match current {
        Focus::Composer if wide_layout => Focus::Sidebar,
        Focus::Composer => Focus::Transcript,
        Focus::Sidebar => Focus::Transcript,
        Focus::Transcript => Focus::Composer,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FlowOption {
    pub(crate) label: String,
    pub(crate) description: String,
}

pub(crate) fn command_flow_options(app: &App) -> Vec<FlowOption> {
    match app.command_flow.as_ref() {
        Some(CommandFlow::Root { .. }) => command_palette_items(&app.command_query)
            .into_iter()
            .map(|command| FlowOption {
                label: command.name.to_string(),
                description: command.description.to_string(),
            })
            .collect(),
        Some(CommandFlow::Mode { .. }) => MODE_OPTIONS
            .iter()
            .map(|(mode, description)| FlowOption {
                label: (*mode).to_string(),
                description: (*description).to_string(),
            })
            .collect(),
        Some(CommandFlow::Provider { .. }) => app
            .providers
            .iter()
            .enumerate()
            .map(|(index, provider)| FlowOption {
                label: provider.name.clone(),
                description: format!(
                    "{} · {}{}",
                    provider.id,
                    app.models_for_provider(index).len(),
                    if provider.configured {
                        " configured model(s)"
                    } else {
                        " model(s), not configured"
                    }
                ),
            })
            .collect(),
        Some(CommandFlow::Model { provider_index, .. }) => app
            .providers
            .get(*provider_index)
            .map(|_| {
                app.models_for_provider(*provider_index)
                    .into_iter()
                    .map(|model| FlowOption {
                        label: model.name,
                        description: model.id,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        Some(CommandFlow::Thinking { .. }) => {
            let Some(capability) = app.active_model_thinking() else {
                return vec![FlowOption {
                    label: "Unavailable".to_string(),
                    description: "The selected model does not expose thinking settings".to_string(),
                }];
            };
            let mut options = vec![FlowOption {
                label: if app.thinking.enabled {
                    "Disable thinking".to_string()
                } else {
                    "Enable thinking".to_string()
                },
                description: format!("Current value: {}", app.thinking_label()),
            }];
            if app.thinking.enabled {
                options.extend(capability.levels.into_iter().map(|level| FlowOption {
                    description: if app.thinking.level.as_deref() == Some(level.as_str()) {
                        "Current effort".to_string()
                    } else {
                        "Select this effort level".to_string()
                    },
                    label: level,
                }));
            }
            options
        }
        None => Vec::new(),
    }
}

pub(crate) fn command_flow_selected(app: &App) -> usize {
    match app.command_flow.as_ref() {
        Some(CommandFlow::Root { selected })
        | Some(CommandFlow::Mode { selected })
        | Some(CommandFlow::Provider { selected }) => *selected,
        Some(CommandFlow::Model { selected, .. }) => *selected,
        Some(CommandFlow::Thinking { selected }) => *selected,
        None => 0,
    }
}

pub(crate) fn command_flow_title(app: &App) -> &'static str {
    match app.command_flow.as_ref() {
        Some(CommandFlow::Root { .. }) => "COMMANDS",
        Some(CommandFlow::Mode { .. }) => "MODE",
        Some(CommandFlow::Provider { .. }) => "PROVIDERS",
        Some(CommandFlow::Model { .. }) => "MODELS",
        Some(CommandFlow::Thinking { .. }) => "THINKING",
        None => "COMMANDS",
    }
}

pub(crate) fn draw(frame: &mut Frame<'_>, app: &App) {
    let area = frame.area();
    frame.render_widget(
        Block::default().style(Style::default().bg(BACKGROUND)),
        area,
    );
    if area.width < 40 || area.height < 10 {
        draw_compact(frame, app, area);
        return;
    }

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Length(1),
        ])
        .split(area);
    draw_topbar(frame, app, root[0]);
    draw_footer(frame, app, root[2]);

    let wide = area.width >= 92;
    let body = if wide {
        Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Length(28), Constraint::Min(1)])
            .split(root[1])
    } else {
        Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(1)])
            .split(root[1])
    };
    if wide {
        draw_sidebar(frame, app, body[0]);
        draw_main(frame, app, body[1]);
    } else {
        draw_main(frame, app, body[0]);
    }

    if app.overlay != Overlay::None {
        draw_overlay(frame, app, area);
    } else if let Some(interaction) = &app.interaction {
        draw_interaction(frame, interaction, area);
    }
}

fn draw_compact(frame: &mut Frame<'_>, app: &App, area: Rect) {
    if area.height == 0 || area.width == 0 {
        return;
    }
    if area.height >= 4 {
        draw_topbar(frame, app, Rect { height: 3, ..area });
    }
    let start = area.y.saturating_add(3).min(area.bottom());
    let height = area.height.saturating_sub(4);
    if height > 0 {
        draw_main(
            frame,
            app,
            Rect {
                y: start,
                height,
                ..area
            },
        );
    }
    if area.height > 1 {
        draw_footer(
            frame,
            app,
            Rect {
                y: area.bottom().saturating_sub(1),
                height: 1,
                ..area
            },
        );
    }
    if app.overlay != Overlay::None {
        draw_overlay(frame, app, area);
    } else if let Some(interaction) = &app.interaction {
        draw_interaction(frame, interaction, area);
    }
}

fn draw_topbar(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(BACKGROUND));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Min(20), Constraint::Length(42)])
        .split(inner);
    let status_marker = if app.running {
        ["|", "/", "-", "\\"][(app.frame_tick as usize) % 4]
    } else if app.last_error.is_some() {
        "x"
    } else {
        "●"
    };
    let brand = Line::from(vec![
        Span::styled(
            " HYS ",
            Style::default()
                .fg(BACKGROUND)
                .bg(ACCENT)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "  HysCode",
            Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  {}", mode_label(&app.mode)),
            Style::default().fg(ACCENT),
        ),
    ]);
    frame.render_widget(Paragraph::new(brand), columns[0]);
    let provider = if app.provider.is_empty() {
        "provider unset".to_string()
    } else {
        app.provider.clone()
    };
    let model = if app.model.is_empty() {
        "model unset".to_string()
    } else {
        app.model.clone()
    };
    let status = format!(
        "{}  {} / {}  · thinking {}",
        status_marker,
        provider,
        model,
        app.thinking_label(),
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            shorten(&status, columns[1].width as usize),
            Style::default().fg(if app.running { WARNING } else { MUTED }),
        )))
        .alignment(ratatui::layout::Alignment::Right),
        columns[1],
    );
    if inner.height > 1 {
        let workspace = format!(
            "  {}",
            shorten_path(&app.workspace, (inner.width / 2) as usize)
        );
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                workspace,
                Style::default().fg(MUTED),
            ))),
            Rect {
                y: inner.y + 1,
                height: 1,
                ..inner
            },
        );
    }
}

fn draw_sidebar(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::RIGHT)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(SURFACE));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width < 4 || inner.height < 4 {
        return;
    }
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(10), Constraint::Min(5)])
        .split(inner);
    let session_id = app
        .current_session_id
        .as_deref()
        .map(|id| shorten(id, sections[0].width.saturating_sub(2) as usize))
        .unwrap_or_else(|| "not started".to_string());
    let details = vec![
        Line::from(Span::styled(
            "WORKSPACE",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            shorten_path(&app.workspace, sections[0].width.saturating_sub(2) as usize),
            Style::default().fg(TEXT),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "SESSION",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(session_id, Style::default().fg(TEXT))),
        Line::from(Span::styled(
            format!("{} visible events", app.transcript.len()),
            Style::default().fg(MUTED),
        )),
        Line::from(Span::styled(
            format!("{} pending request(s)", app.pending_request_count()),
            Style::default().fg(MUTED),
        )),
    ];
    frame.render_widget(
        Paragraph::new(Text::from(details)).wrap(Wrap { trim: true }),
        sections[0],
    );

    let action_block = Block::default()
        .title(Span::styled(" ACTIONS ", Style::default().fg(MUTED)))
        .borders(Borders::TOP)
        .border_style(Style::default().fg(BORDER));
    let action_inner = action_block.inner(sections[1]);
    frame.render_widget(action_block, sections[1]);
    let mut lines = Vec::new();
    for (index, (label, hint)) in SIDEBAR_ACTIONS.iter().enumerate() {
        let selected = app.focus == Focus::Sidebar && app.sidebar_index == index;
        let style = if selected {
            Style::default()
                .fg(BACKGROUND)
                .bg(ACCENT)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        lines.push(Line::from(vec![
            Span::styled(if selected { "› " } else { "  " }, style),
            Span::styled(
                shorten(label, action_inner.width.saturating_sub(7) as usize),
                style,
            ),
            Span::styled(format!("  {}", hint), style.add_modifier(Modifier::DIM)),
        ]));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), action_inner);
}

fn draw_main(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(3),
            Constraint::Length(6),
        ])
        .split(area);
    draw_conversation_header(frame, app, sections[0]);
    draw_transcript(frame, app, sections[1]);
    draw_composer(frame, app, sections[2]);
}

fn draw_conversation_header(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(BORDER));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    let session = app
        .current_session_id
        .as_deref()
        .map(|id| format!("session {}", shorten(id, 26)))
        .unwrap_or_else(|| "new session".to_string());
    let title = Line::from(vec![
        Span::styled(
            "CONVERSATION",
            Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
        ),
        Span::styled(format!("  /  {}", session), Style::default().fg(MUTED)),
    ]);
    frame.render_widget(Paragraph::new(title), inner);
    if inner.height > 1 {
        let focus = match app.focus {
            Focus::Composer => "COMPOSER",
            Focus::Sidebar => "SIDEBAR",
            Focus::Transcript => "TRANSCRIPT",
        };
        let subline = format!(
            "{}  ·  {}  ·  {}",
            focus,
            if app.running { "agent active" } else { "ready" },
            app.status
        );
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                shorten(&subline, inner.width as usize),
                if app.last_error.is_some() {
                    Style::default().fg(ERROR)
                } else {
                    Style::default().fg(MUTED)
                },
            ))),
            Rect {
                y: inner.y + 1,
                height: 1,
                ..inner
            },
        );
    }
}

fn draw_transcript(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let block = Block::default()
        .title(Line::from(vec![
            Span::styled(
                " STREAM ",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(" conversation history ", Style::default().fg(MUTED)),
        ]))
        .borders(Borders::LEFT | Borders::RIGHT)
        .border_style(Style::default().fg(BORDER));
    let inner = block.inner(area);
    let lines = transcript_lines(&app.transcript, inner.width);
    let content = if lines.is_empty() {
        vec![
            Line::from(Span::styled(
                "No turns in this session yet.",
                Style::default().fg(TEXT),
            )),
            Line::from(Span::styled(
                "Describe a change, ask for an explanation, or press Ctrl-K to browse actions.",
                Style::default().fg(MUTED),
            )),
        ]
    } else {
        lines
    };
    let offset = transcript_offset(content.len(), inner.height, app.scroll);
    frame.render_widget(
        Paragraph::new(Text::from(content))
            .scroll((offset, 0))
            .wrap(Wrap { trim: false })
            .block(block),
        area,
    );
}

fn draw_composer(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let active = app.focus == Focus::Composer;
    let border_color = if app.interaction.is_some() {
        WARNING
    } else if active {
        ACCENT
    } else {
        BORDER
    };
    let block = Block::default()
        .title(Span::styled(
            if app.interaction.is_some() {
                " RESPONSE "
            } else {
                " COMPOSER "
            },
            Style::default()
                .fg(border_color)
                .add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .style(Style::default().bg(SURFACE));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    let (prompt, placeholder) = composer_copy(app);
    let prompt_width = prompt.chars().count() as u16;
    let available = inner.width.saturating_sub(prompt_width);
    let (visible, cursor) = visible_input(&app.input, app.input_cursor, available);
    let input_line = if app.input.is_empty() {
        Line::from(vec![
            Span::styled(prompt, Style::default().fg(ACCENT)),
            Span::styled(placeholder, Style::default().fg(MUTED)),
        ])
    } else {
        Line::from(vec![
            Span::styled(prompt, Style::default().fg(ACCENT)),
            Span::styled(visible, Style::default().fg(TEXT)),
        ])
    };
    frame.render_widget(Paragraph::new(input_line), Rect { height: 1, ..inner });
    if inner.height > 1 {
        let hint = if app.command_flow.is_some() {
            "↑↓ select   Enter accept   Esc back to messages"
        } else if app.interaction.is_some() {
            "Enter submit   Y allow   N deny   T trust   Esc close"
        } else {
            "Enter send   Tab complete   Ctrl-K commands   Ctrl-C cancel/quit"
        };
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(hint, Style::default().fg(MUTED)))),
            Rect {
                y: inner.y + inner.height.saturating_sub(1),
                height: 1,
                ..inner
            },
        );
    }
    if active && app.overlay == Overlay::None {
        frame.set_cursor_position((
            inner
                .x
                .saturating_add(prompt_width)
                .saturating_add(cursor)
                .min(inner.right().saturating_sub(1)),
            inner.y,
        ));
    }
    if active && app.interaction.is_none() && app.overlay == Overlay::None {
        let commands = matching_commands(&app.input);
        if !commands.is_empty() {
            draw_inline_palette(frame, app, area, &commands);
        }
    }
}

fn draw_footer(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let focus = match app.focus {
        Focus::Composer => "composer",
        Focus::Sidebar => "sidebar",
        Focus::Transcript => "transcript",
    };
    let line = Line::from(vec![
        Span::styled(
            format!(" {} ", focus.to_ascii_uppercase()),
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "  Tab focus  ·  Ctrl-K palette  ·  F1 help  ·  PgUp/PgDn scroll",
            Style::default().fg(MUTED),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(line).block(
            Block::default()
                .borders(Borders::TOP)
                .border_style(Style::default().fg(BORDER)),
        ),
        area,
    );
}

fn draw_inline_palette(
    frame: &mut Frame<'_>,
    app: &App,
    composer_area: Rect,
    commands: &[CommandSpec],
) {
    let visible_count = commands.len().min(5);
    let height = (visible_count as u16).saturating_add(2);
    let width = composer_area.width.min(72);
    if width == 0 {
        return;
    }
    let y = composer_area.y.saturating_sub(height);
    let popup = Rect {
        x: composer_area.x + composer_area.width.saturating_sub(width),
        y,
        width,
        height,
    };
    frame.render_widget(Clear, popup);
    let block = Block::default()
        .title(Span::styled(
            " COMMANDS ",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(ACCENT))
        .style(Style::default().bg(SURFACE_RAISED));
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    let selected = app.overlay_index.min(commands.len().saturating_sub(1));
    let start = selected.saturating_sub(visible_count.saturating_sub(1));
    let mut lines = Vec::new();
    for (index, command) in commands.iter().enumerate().skip(start).take(visible_count) {
        let style = if selected == index {
            Style::default()
                .fg(BACKGROUND)
                .bg(ACCENT)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        lines.push(Line::from(vec![
            Span::styled(if selected == index { "› " } else { "  " }, style),
            Span::styled(command.name, style),
            Span::styled(
                format!("  {}", command.description),
                style.add_modifier(Modifier::DIM),
            ),
        ]));
    }
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn draw_overlay(frame: &mut Frame<'_>, app: &App, area: Rect) {
    match app.overlay {
        Overlay::Help => draw_help(frame, area),
        Overlay::CommandPalette => draw_command_palette(frame, app, area),
        Overlay::SessionList => draw_session_list(frame, app, area),
        Overlay::ProjectList => draw_project_list(frame, app, area),
        Overlay::None => {}
    }
}

fn draw_command_palette(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let items = command_flow_options(app);
    let max_rows = area.height.saturating_sub(8).max(1) as usize;
    let height = (items.len().min(max_rows) as u16).saturating_add(7);
    let popup = centered_rect(area, area.width.saturating_sub(8).min(92), height);
    frame.render_widget(Clear, popup);
    let title = format!(
        " {}  ·  Enter accept  ·  Esc back ",
        command_flow_title(app)
    );
    let block = modal_block(&title, ACCENT);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    let selected = command_flow_selected(app).min(items.len().saturating_sub(1));
    let start = selected.saturating_sub(max_rows.saturating_sub(1));
    let mut lines = vec![Line::from(vec![
        Span::styled(" query ", Style::default().fg(MUTED)),
        Span::styled(
            if matches!(app.command_flow, Some(CommandFlow::Root { .. })) {
                app.command_query.as_str()
            } else {
                "visual selection"
            },
            Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
        ),
    ])];
    if items.is_empty() {
        lines.push(Line::from(Span::styled(
            "No command matches this query. Backspace to search again.",
            Style::default().fg(WARNING),
        )));
    }
    for (index, option) in items.iter().enumerate().skip(start).take(max_rows) {
        let selected_style = if index == selected {
            Style::default()
                .fg(BACKGROUND)
                .bg(ACCENT)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(TEXT)
        };
        lines.push(Line::from(vec![
            Span::styled(if index == selected { "› " } else { "  " }, selected_style),
            Span::styled(shorten(&option.label, 24), selected_style),
            Span::styled(
                format!("  {}", option.description),
                selected_style.add_modifier(Modifier::DIM),
            ),
        ]));
    }
    lines.push(Line::from(Span::styled(
        "↑↓ / j k select   Enter accept   Esc back",
        Style::default().fg(MUTED),
    )));
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn draw_help(frame: &mut Frame<'_>, area: Rect) {
    let popup = centered_rect(
        area,
        area.width.saturating_sub(10).min(82),
        area.height.saturating_sub(6).min(20),
    );
    frame.render_widget(Clear, popup);
    let block = modal_block(" HELP  keyboard-first navigation ", ACCENT);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    let lines = vec![
        Line::from(Span::styled(
            "NAVIGATION",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from("Tab        cycle composer, sidebar, and transcript"),
        Line::from("Ctrl-K     open the command palette"),
        Line::from("F1 / Esc   open or close this surface"),
        Line::from("↑ ↓ / j k  move through the focused surface"),
        Line::from("PgUp/PgDn  scroll conversation history"),
        Line::from(""),
        Line::from(Span::styled(
            "COMPOSER",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from("/          enter the visual command loop"),
        Line::from("Enter      accept the selected command or option"),
        Line::from("Esc        return to the previous command level"),
        Line::from("Messages   never receive slash-command input"),
        Line::from("Ctrl-C     cancel the turn, then quit when empty"),
        Line::from(""),
        Line::from(Span::styled(
            "COMMANDS",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from("/new  /sessions  /projects  /mode  /thinking  /model  /models"),
        Line::from("/diagnostics  /retry  /cancel  /clear  /quit"),
    ];
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: false }),
        inner,
    );
}

fn draw_session_list(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let height = (app.sessions.len().min(12) as u16)
        .saturating_add(5)
        .min(area.height.saturating_sub(2));
    let popup = centered_rect(area, area.width.saturating_sub(8).min(84), height.max(6));
    frame.render_widget(Clear, popup);
    let block = modal_block(" SAVED SESSIONS  Enter load ", ACCENT);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    if app.sessions.is_empty() {
        frame.render_widget(
            Paragraph::new(Text::from(vec![
                Line::from(Span::styled(
                    "No saved sessions for this workspace.",
                    Style::default().fg(TEXT),
                )),
                Line::from(Span::styled(
                    "Esc closes this view.",
                    Style::default().fg(MUTED),
                )),
            ])),
            inner,
        );
        return;
    }
    let selected = app.overlay_index.min(app.sessions.len() - 1);
    let lines = app
        .sessions
        .iter()
        .enumerate()
        .take(inner.height as usize)
        .map(|(index, session)| session_line(index, selected, session, inner.width))
        .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn draw_project_list(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let height = (app.projects.len().min(12) as u16)
        .saturating_add(5)
        .min(area.height.saturating_sub(2));
    let popup = centered_rect(area, area.width.saturating_sub(8).min(84), height.max(6));
    frame.render_widget(Clear, popup);
    let block = modal_block(" PROJECTS  Enter switch ", ACCENT);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    if app.projects.is_empty() {
        frame.render_widget(
            Paragraph::new(Text::from(vec![
                Line::from(Span::styled(
                    "No saved projects available.",
                    Style::default().fg(TEXT),
                )),
                Line::from(Span::styled(
                    "Esc closes this view.",
                    Style::default().fg(MUTED),
                )),
            ])),
            inner,
        );
        return;
    }
    let selected = app.overlay_index.min(app.projects.len() - 1);
    let lines = app
        .projects
        .iter()
        .enumerate()
        .take(inner.height as usize)
        .map(|(index, project)| project_line(index, selected, project, inner.width))
        .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn session_line(
    index: usize,
    selected: usize,
    session: &SessionSummary,
    width: u16,
) -> Line<'static> {
    let style = if index == selected {
        Style::default()
            .fg(BACKGROUND)
            .bg(ACCENT)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(TEXT)
    };
    Line::from(vec![
        Span::styled(if index == selected { "› " } else { "  " }, style),
        Span::styled(
            shorten(&session.title, width.saturating_sub(22) as usize),
            style,
        ),
        Span::styled(
            format!(
                "  {} msg  {}",
                session.message_count,
                shorten(&session.id, 10)
            ),
            style.add_modifier(Modifier::DIM),
        ),
    ])
}

fn project_line(
    index: usize,
    selected: usize,
    project: &ProjectSummary,
    width: u16,
) -> Line<'static> {
    let style = if index == selected {
        Style::default()
            .fg(BACKGROUND)
            .bg(ACCENT)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(TEXT)
    };
    Line::from(vec![
        Span::styled(if index == selected { "› " } else { "  " }, style),
        Span::styled(
            shorten_path(&project.workspace_path, width.saturating_sub(20) as usize),
            style,
        ),
        Span::styled(
            format!("  {} session(s)", project.session_count),
            style.add_modifier(Modifier::DIM),
        ),
    ])
}

fn draw_interaction(frame: &mut Frame<'_>, interaction: &Interaction, area: Rect) {
    let height = match interaction {
        Interaction::Question { .. } => 10,
        _ => 11,
    };
    let popup = centered_rect(area, area.width.saturating_sub(8).min(84), height);
    frame.render_widget(Clear, popup);
    let block = modal_block(" AGENT INTERACTION  response required ", WARNING);
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    let lines = match interaction {
        Interaction::Approval {
            tool_name,
            description,
            risk,
            ..
        } => vec![
            Line::from(Span::styled(
                "The agent wants to use a tool.",
                Style::default().fg(TEXT),
            )),
            Line::from(""),
            Line::from(vec![
                Span::styled("Tool  ", Style::default().fg(MUTED)),
                Span::styled(
                    tool_name.clone(),
                    Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(vec![
                Span::styled("Risk  ", Style::default().fg(MUTED)),
                Span::styled(risk.clone(), Style::default().fg(WARNING)),
            ]),
            Line::from(Span::styled(
                shorten(description, inner.width as usize),
                Style::default().fg(TEXT),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "Y allow   N deny   T allow and trust",
                Style::default().fg(WARNING),
            )),
        ],
        Interaction::ModeSwitch {
            from, to, reason, ..
        } => vec![
            Line::from(Span::styled(
                "The runtime requested an agent mode change.",
                Style::default().fg(TEXT),
            )),
            Line::from(""),
            Line::from(format!("{}  →  {}", from, to)),
            Line::from(Span::styled(
                shorten(reason, inner.width as usize),
                Style::default().fg(MUTED),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "Y allow   N deny",
                Style::default().fg(WARNING),
            )),
        ],
        Interaction::Question {
            title, question, ..
        } => vec![
            Line::from(Span::styled(
                title.clone(),
                Style::default().fg(TEXT).add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from(Span::styled(question.clone(), Style::default().fg(TEXT))),
            Line::from(""),
            Line::from(Span::styled(
                "Type the answer in the composer and press Enter.",
                Style::default().fg(WARNING),
            )),
        ],
    };
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: false }),
        inner,
    );
}

fn modal_block(title: &str, color: Color) -> Block<'static> {
    Block::default()
        .title(Span::styled(
            title.to_string(),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(color))
        .style(Style::default().bg(SURFACE_RAISED))
}

fn composer_copy(app: &App) -> (String, String) {
    if app.command_flow.is_some() {
        return (
            "command › ".to_string(),
            "Use the visual command selector above".to_string(),
        );
    }
    match app.interaction.as_ref() {
        Some(Interaction::Approval { .. }) | Some(Interaction::ModeSwitch { .. }) => (
            "choice › ".to_string(),
            "Use the highlighted approval keys above".to_string(),
        ),
        Some(Interaction::Question { .. }) => {
            ("answer › ".to_string(), "Type your answer".to_string())
        }
        None if app.input.starts_with('/') => ("cmd › ".to_string(), "Type a command".to_string()),
        None => (
            "ask › ".to_string(),
            "Describe what you want to build or investigate".to_string(),
        ),
    }
}

fn transcript_lines(
    items: &std::collections::VecDeque<TranscriptItem>,
    width: u16,
) -> Vec<Line<'static>> {
    let width = width.max(1) as usize;
    let mut lines = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        let (label, marker, color) = transcript_style(item.kind);
        let prefix = format!("{} {} ", marker, label);
        let first_width = width.saturating_sub(prefix.chars().count()).max(1);
        let mut first_line = true;
        for raw in item.text.split('\n') {
            for segment in wrap_text(
                raw,
                if first_line {
                    first_width
                } else {
                    width.saturating_sub(3).max(1)
                },
            ) {
                if first_line {
                    lines.push(Line::from(vec![
                        Span::styled(
                            prefix.clone(),
                            Style::default().fg(color).add_modifier(Modifier::BOLD),
                        ),
                        Span::styled(segment, Style::default().fg(TEXT)),
                    ]));
                    first_line = false;
                } else {
                    lines.push(Line::from(vec![
                        Span::styled("   ", Style::default().fg(color)),
                        Span::styled(segment, Style::default().fg(TEXT)),
                    ]));
                }
            }
        }
        if item_index + 1 < items.len() {
            lines.push(Line::from(""));
        }
    }
    lines
}

fn transcript_style(kind: TranscriptKind) -> (&'static str, &'static str, Color) {
    match kind {
        TranscriptKind::User => ("you", ">", ACCENT),
        TranscriptKind::Assistant => ("agent", "◇", ACCENT),
        TranscriptKind::Thinking => ("thinking", "~", WARNING),
        TranscriptKind::Tool => ("tool", "·", WARNING),
        TranscriptKind::Result => ("result", "+", SUCCESS),
        TranscriptKind::System => ("note", "i", MUTED),
        TranscriptKind::Error => ("error", "x", ERROR),
    }
}

pub(crate) fn wrap_text(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![String::new()];
    }
    if text.is_empty() {
        return vec![String::new()];
    }
    let chars = text.chars().collect::<Vec<_>>();
    chars
        .chunks(width)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

pub(crate) fn transcript_offset(
    line_count: usize,
    viewport_height: u16,
    distance_from_bottom: u16,
) -> u16 {
    let max_offset = line_count.saturating_sub(viewport_height as usize) as u16;
    max_offset.saturating_sub(distance_from_bottom)
}

pub(crate) fn visible_input(input: &str, cursor: usize, width: u16) -> (String, u16) {
    let chars = input.chars().collect::<Vec<_>>();
    let cursor = cursor.min(chars.len());
    let width = width as usize;
    if width == 0 {
        return (String::new(), 0);
    }
    if chars.len() <= width {
        return (chars.iter().collect(), cursor as u16);
    }
    let mut start = cursor.saturating_sub(width.saturating_sub(1));
    if start + width > chars.len() {
        start = chars.len() - width;
    }
    let visible = chars[start..start + width].iter().collect::<String>();
    (visible, cursor.saturating_sub(start) as u16)
}

fn centered_rect(area: Rect, width: u16, height: u16) -> Rect {
    let width = width.min(area.width.saturating_sub(2)).max(1);
    let height = height.min(area.height.saturating_sub(2)).max(1);
    Rect {
        x: area.x + area.width.saturating_sub(width) / 2,
        y: area.y + area.height.saturating_sub(height) / 2,
        width,
        height,
    }
}

fn mode_label(mode: &str) -> String {
    if mode.is_empty() {
        "chat".to_string()
    } else {
        mode.to_string()
    }
}

fn shorten_path(path: &str, width: usize) -> String {
    if path.chars().count() <= width {
        return path.to_string();
    }
    if width < 8 {
        return shorten(path, width);
    }
    let tail = path
        .chars()
        .rev()
        .take(width.saturating_sub(5))
        .collect::<Vec<_>>();
    format!("…/{}", tail.into_iter().rev().collect::<String>())
}

fn shorten(value: &str, width: usize) -> String {
    if value.chars().count() <= width {
        return value.to_string();
    }
    if width < 2 {
        return value.chars().take(width).collect();
    }
    format!("{}…", value.chars().take(width - 1).collect::<String>())
}

#[cfg(test)]
mod tests {
    use super::{
        command_palette_items, matching_commands, next_focus, transcript_lines, transcript_offset,
        visible_input, wrap_text, Focus,
    };
    use crate::{TranscriptItem, TranscriptKind};
    use std::collections::VecDeque;

    #[test]
    fn slash_commands_filter_without_hiding_the_root_command() {
        let commands = matching_commands("/model");
        assert_eq!(
            commands.iter().map(|item| item.name).collect::<Vec<_>>(),
            vec!["/model", "/models"]
        );
        assert_eq!(
            matching_commands("/models")
                .iter()
                .map(|item| item.name)
                .collect::<Vec<_>>(),
            vec!["/models"]
        );
        assert!(matching_commands("/unknown").is_empty());
        assert_eq!(command_palette_items("/").len(), 16);
        assert_eq!(
            matching_commands("/thinking")
                .iter()
                .map(|item| item.name)
                .collect::<Vec<_>>(),
            vec!["/thinking"]
        );
        assert!(command_palette_items("/unknown").is_empty());
    }

    #[test]
    fn transcript_scroll_keeps_newest_lines_at_distance_zero() {
        assert_eq!(transcript_offset(20, 5, 0), 15);
        assert_eq!(transcript_offset(20, 5, 4), 11);
        assert_eq!(transcript_offset(3, 5, 0), 0);
    }

    #[test]
    fn input_window_tracks_unicode_cursor() {
        assert_eq!(visible_input("abcdef", 6, 4), ("cdef".to_string(), 4));
        assert_eq!(visible_input("Olá mundo", 3, 5), ("Olá m".to_string(), 3));
    }

    #[test]
    fn text_wrap_preserves_empty_lines() {
        assert_eq!(wrap_text("abcdef", 3), vec!["abc", "def"]);
        assert_eq!(wrap_text("", 3), vec![""]);
    }

    #[test]
    fn focus_cycle_keeps_sidebar_out_of_compact_layouts() {
        assert_eq!(next_focus(Focus::Composer, true), Focus::Sidebar);
        assert_eq!(next_focus(Focus::Sidebar, true), Focus::Transcript);
        assert_eq!(next_focus(Focus::Composer, false), Focus::Transcript);
        assert_eq!(next_focus(Focus::Transcript, false), Focus::Composer);
    }

    #[test]
    fn transcript_renderer_keeps_role_labels_and_wraps_content() {
        let mut items = VecDeque::new();
        items.push_back(TranscriptItem {
            kind: TranscriptKind::Assistant,
            text: "abcdef".to_string(),
        });
        let lines = transcript_lines(&items, 12);
        let rendered = lines
            .iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>();
        assert!(rendered.first().is_some_and(|line| line.contains("agent")));
        assert!(rendered.iter().any(|line| line.contains("abcd")));
        assert!(rendered.iter().any(|line| line.contains("ef")));
    }
}
