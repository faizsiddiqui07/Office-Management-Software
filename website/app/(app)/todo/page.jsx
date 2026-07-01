'use client';

import { ListTodo } from 'lucide-react';
import { PageHeader } from '@/components/glass/page-header';
import { TaskBoard } from '@/components/tasks/task-board';

export default function TodoPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Work"
        title="To-Do"
        icon={ListTodo}
        description="Note your work, tick it off as you go — everything is recorded. Leadership can assign tasks down the line."
      />
      <TaskBoard />
    </div>
  );
}
