/* ============================================================================
 * Aurora UI — public API
 * ==========================================================================*/


// ---- Utilities & hooks ------------------------------------------------------
export { cn } from "./lib/cn";
export { useClipboard, type UseClipboardOptions } from "./lib/hooks/useClipboard";
export { useMediaQuery } from "./lib/hooks/useMediaQuery";
export {
  useControllableState,
  type UseControllableStateParams,
} from "./lib/hooks/useControllableState";

// ---- Providers --------------------------------------------------------------
export {
  ThemeProvider,
  useTheme,
  type Theme,
  type ThemeProviderProps,
} from "./providers/ThemeProvider";

// ---- Primitives: layout -----------------------------------------------------
export { Box, type BoxProps } from "./components/primitives/Box";
export {
  Stack,
  HStack,
  VStack,
  type StackProps,
} from "./components/primitives/Stack";
export { Container, type ContainerProps } from "./components/primitives/Container";
export { Divider, type DividerProps } from "./components/primitives/Divider";
export { ScrollArea, ScrollBar } from "./components/primitives/ScrollArea";

// ---- Primitives: typography -------------------------------------------------
export {
  Heading,
  Text,
  Code,
  Kbd,
  Link,
  type HeadingProps,
  type TextProps,
  type CodeProps,
  type KbdProps,
  type LinkProps,
} from "./components/primitives/Typography";

// ---- Primitives: actions ----------------------------------------------------
export { Button, buttonVariants, type ButtonProps } from "./components/primitives/Button";
export { IconButton, type IconButtonProps } from "./components/primitives/IconButton";
export { ButtonGroup, type ButtonGroupProps } from "./components/primitives/ButtonGroup";
export { Spinner, type SpinnerProps } from "./components/primitives/Spinner";
export { ThemeToggle } from "./components/primitives/ThemeToggle";

// ---- Primitives: forms ------------------------------------------------------
export { Input, type InputProps } from "./components/primitives/Input";
export { Textarea, type TextareaProps } from "./components/primitives/Textarea";
export { Select, type SelectProps } from "./components/primitives/Select";
export { Checkbox, type CheckboxProps } from "./components/primitives/Checkbox";
export { Switch, type SwitchProps } from "./components/primitives/Switch";
export { RadioGroup, RadioGroupItem } from "./components/primitives/RadioGroup";
export { Slider } from "./components/primitives/Slider";
export { NumberInput, type NumberInputProps } from "./components/primitives/NumberInput";
export { SearchInput, type SearchInputProps } from "./components/primitives/SearchInput";
export {
  Combobox,
  type ComboboxProps,
  type ComboboxOption,
} from "./components/primitives/Combobox";
export { FileUpload, type FileUploadProps } from "./components/primitives/FileUpload";
export {
  Field,
  Label,
  type FieldProps,
  type LabelProps,
} from "./components/primitives/Field";

// ---- Primitives: feedback ---------------------------------------------------
export { Badge, type BadgeProps } from "./components/primitives/Badge";
export { Alert, type AlertProps } from "./components/primitives/Alert";
export { Skeleton, type SkeletonProps } from "./components/primitives/Skeleton";
export { Progress, type ProgressProps } from "./components/primitives/Progress";
export { EmptyState, type EmptyStateProps } from "./components/primitives/EmptyState";
export {
  ToastProvider,
  useToast,
  type ToastOptions,
  type ToastVariant,
} from "./components/primitives/Toast";

// ---- Primitives: overlays ---------------------------------------------------
export {
  Tooltip,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  type TooltipProps,
} from "./components/primitives/Tooltip";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
} from "./components/primitives/Dialog";
export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
} from "./components/primitives/Popover";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuRadioGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "./components/primitives/DropdownMenu";
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  type SheetContentProps,
} from "./components/primitives/Sheet";
export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "./components/primitives/HoverCard";
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuGroup,
  ContextMenuSub,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "./components/primitives/ContextMenu";
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/primitives/Collapsible";

// ---- Primitives: navigation & data -----------------------------------------
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./components/primitives/Tabs";
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/primitives/Accordion";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
} from "./components/primitives/Card";
export {
  Avatar,
  AvatarGroup,
  type AvatarProps,
  type AvatarGroupProps,
} from "./components/primitives/Avatar";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./components/primitives/Table";
export {
  Breadcrumbs,
  type BreadcrumbsProps,
  type BreadcrumbItem,
} from "./components/primitives/Breadcrumbs";
export { Pagination, type PaginationProps } from "./components/primitives/Pagination";
export { Stepper, type StepperProps, type Step } from "./components/primitives/Stepper";
export {
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  toggleVariants,
  type ToggleProps,
  type ToggleGroupItemProps,
} from "./components/primitives/Toggle";
export { Tag, type TagProps } from "./components/primitives/Tag";
export { Timeline, type TimelineProps, type TimelineItem } from "./components/primitives/Timeline";
export { Stat, type StatProps } from "./components/primitives/Stat";

// ---- IDE components ---------------------------------------------------------
export { CodeBlock, type CodeBlockProps } from "./components/ide/CodeBlock";
export { CodeEditor, type CodeEditorProps } from "./components/ide/CodeEditor";
export { auroraPrismTheme } from "./components/ide/prismTheme";
export {
  FileTree,
  type FileTreeProps,
  type FileNode,
} from "./components/ide/FileTree";
export { TabBar, type TabBarProps, type EditorTab } from "./components/ide/TabBar";
export {
  Terminal,
  type TerminalProps,
  type TerminalLine,
  type TerminalLineKind,
} from "./components/ide/Terminal";
export {
  StatusBar,
  StatusBarItem,
  type StatusBarProps,
  type StatusBarItemProps,
} from "./components/ide/StatusBar";
export {
  ActivityBar,
  type ActivityBarProps,
  type ActivityBarItem,
} from "./components/ide/ActivityBar";
export {
  CommandPalette,
  useCommandPalette,
  type CommandPaletteProps,
  type Command,
} from "./components/ide/CommandPalette";
export {
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelProps,
  type ResizablePanelGroupProps,
} from "./components/ide/Resizable";
export { DiffViewer, type DiffViewerProps } from "./components/ide/DiffViewer";
export { GhostText, type GhostTextProps } from "./components/ide/GhostText";
export {
  SearchPanel,
  type SearchPanelProps,
  type SearchPanelState,
} from "./components/ide/SearchPanel";
export {
  FilePathBreadcrumb,
  type FilePathBreadcrumbProps,
} from "./components/ide/FilePathBreadcrumb";

// ---- AI Chat ----------------------------------------------------------------
export {
  TypingIndicator,
  type TypingIndicatorProps,
} from "./components/chat/TypingIndicator";
export { StreamingText, type StreamingTextProps } from "./components/chat/StreamingText";
export { MessageActions, type MessageActionsProps } from "./components/chat/MessageActions";
export {
  PromptSuggestions,
  type PromptSuggestionsProps,
  type PromptSuggestion,
} from "./components/chat/PromptSuggestions";
export {
  ModelSelector,
  type ModelSelectorProps,
  type ModelOption,
} from "./components/chat/ModelSelector";
export {
  AttachmentChip,
  AttachmentList,
  type AttachmentChipProps,
  type AttachmentListProps,
  type AttachmentData,
} from "./components/chat/Attachment";
export {
  Citation,
  SourceList,
  type CitationProps,
  type SourceListProps,
  type Source,
} from "./components/chat/Citation";
export {
  Conversation,
  type ConversationProps,
} from "./components/chat/Conversation";
export {
  ConversationList,
  type ConversationListProps,
  type Conversation as ConversationItem,
} from "./components/chat/ConversationList";

// ---- AI Agent (Codex / Claude Code style) -----------------------------------
export { type AgentStatus } from "./components/agent/types";
export { StatusIcon, type StatusIconProps } from "./components/agent/StatusIcon";
export { ToolCall, type ToolCallProps } from "./components/agent/ToolCall";
export { ThinkingBlock, type ThinkingBlockProps } from "./components/agent/ThinkingBlock";
export {
  TaskList,
  type TaskListProps,
  type Task,
  type TaskStatus,
} from "./components/agent/TaskList";
export {
  FileEditCard,
  type FileEditCardProps,
  type EditKind,
} from "./components/agent/FileEditCard";
export {
  CommandApproval,
  type CommandApprovalProps,
} from "./components/agent/CommandApproval";
export {
  AgentStatusBar,
  type AgentStatusBarProps,
} from "./components/agent/AgentStatusBar";
export { TokenUsage, type TokenUsageProps } from "./components/agent/TokenUsage";
export {
  FileReference,
  ContextPill,
  type FileReferenceProps,
  type ContextPillProps,
} from "./components/agent/FileReference";
export {
  ViewportSwitcher,
  VIEWPORT_WIDTHS,
  type ViewportSwitcherProps,
  type Viewport,
} from "./components/agent/ViewportSwitcher";
export { WebPreview, type WebPreviewProps } from "./components/agent/WebPreview";
export {
  GenerationProgress,
  type GenerationProgressProps,
  type GenerationStep,
} from "./components/agent/GenerationProgress";
export {
  FileGenerationList,
  type FileGenerationListProps,
  type GeneratedFile,
  type FileChangeKind,
} from "./components/agent/FileGenerationList";
export {
  CheckpointList,
  type CheckpointListProps,
  type Checkpoint,
} from "./components/agent/CheckpointList";
export {
  DeployBar,
  type DeployBarProps,
  type DeployStatus,
} from "./components/agent/DeployBar";
export { UsageMeter, type UsageMeterProps } from "./components/agent/UsageMeter";
export {
  AgentMessage,
  TurnFooter,
  type AgentMessageProps,
  type TurnFooterProps,
} from "./components/agent/AgentMessage";
export { CommandBlock, type CommandBlockProps } from "./components/agent/CommandBlock";
export { PlanCard, type PlanCardProps } from "./components/agent/PlanCard";
export {
  PermissionModeSelector,
  type PermissionModeSelectorProps,
  type PermissionMode,
  type PermissionModeOption,
} from "./components/agent/PermissionModeSelector";
export { ContextMeter, type ContextMeterProps } from "./components/agent/ContextMeter";
export {
  McpServerStatus,
  McpToolBadge,
  type McpServerStatusProps,
  type McpServer,
  type McpToolBadgeProps,
} from "./components/agent/McpServerStatus";
export {
  SubagentCard,
  type SubagentCardProps,
} from "./components/agent/SubagentCard";
export {
  CompactionNotice,
  type CompactionNoticeProps,
} from "./components/agent/CompactionNotice";
export {
  SessionHeader,
  type SessionHeaderProps,
} from "./components/agent/SessionHeader";
export {
  ShortcutHints,
  type ShortcutHintsProps,
  type ShortcutHint,
} from "./components/agent/ShortcutHints";
export {
  QueuedMessages,
  type QueuedMessagesProps,
} from "./components/agent/QueuedMessages";
export { RetryNotice, type RetryNoticeProps } from "./components/agent/RetryNotice";
export {
  ListboxMenu,
  type ListboxMenuProps,
  type ListboxItem,
} from "./components/agent/ListboxMenu";
export {
  SlashCommandMenu,
  type SlashCommandMenuProps,
  type SlashCommand,
} from "./components/agent/SlashCommandMenu";
export {
  MentionMenu,
  type MentionMenuProps,
  type MentionItem,
  type MentionKind,
} from "./components/agent/MentionMenu";
export { InlineChat, type InlineChatProps } from "./components/agent/InlineChat";
export {
  SuggestionCard,
  type SuggestionCardProps,
} from "./components/agent/SuggestionCard";
export {
  ChangeList,
  DiffStat,
  type ChangeListProps,
  type FileChange,
  type ChangeState,
  type DiffStatProps,
} from "./components/agent/ChangeList";
export {
  ApprovalToolbar,
  type ApprovalToolbarProps,
} from "./components/agent/ApprovalToolbar";
export {
  RunControls,
  type RunControlsProps,
  type RunState,
} from "./components/agent/RunControls";
export {
  LogStream,
  type LogStreamProps,
  type LogEntry,
  type LogLevel,
} from "./components/agent/LogStream";

// ---- Patterns ---------------------------------------------------------------
export { PromptInput, type PromptInputProps } from "./components/patterns/PromptInput";
export {
  ChatMessage,
  type ChatMessageProps,
  type ChatRole,
} from "./components/patterns/ChatMessage";
export { AppShell, type AppShellProps } from "./components/patterns/AppShell";
