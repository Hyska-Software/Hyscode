import { TaskList as AuroraTaskList, type Task, type TaskStatus } from '@hyscode/ui';
import { useAgentStore } from '@/stores/agent-store';

function mapStatus(s: string): TaskStatus {
  switch (s) {
    case 'in_progress': return 'in_progress';
    case 'completed': return 'completed';
    case 'blocked': return 'cancelled';
    case 'not_started':
    default: return 'pending';
  }
}

export function AgentTaskList() {
  const tasks = useAgentStore((s) => s.agentTasks);
  if (tasks.length === 0) return null;

  const mapped: Task[] = tasks.map((t) => ({
    id: String(t.id),
    content: t.title,
    status: mapStatus(t.status),
  }));

  return (
    <AuroraTaskList
      tasks={mapped}
      title={`Todos (${tasks.filter((t) => t.status === 'completed').length}/${tasks.length})`}
      showProgress
      className="mx-4 my-2"
    />
  );
}
