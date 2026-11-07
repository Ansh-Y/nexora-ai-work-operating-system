import { PrismaClient, OrganizationRole, ProjectStatus, TaskStatus, Priority } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('NexoraDemo!2026', 12);
  const user = await prisma.user.upsert({ where: { email: 'demo@nexora.local' }, update: { name: 'Alex Morgan', passwordHash }, create: { email: 'demo@nexora.local', name: 'Alex Morgan', passwordHash } });
  const org = await prisma.organization.upsert({ where: { slug: 'nexora-demo' }, update: { name: 'Nexora Studio' }, create: { slug: 'nexora-demo', name: 'Nexora Studio' } });
  await prisma.membership.upsert({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } }, update: { role: OrganizationRole.OWNER }, create: { organizationId: org.id, userId: user.id, role: OrganizationRole.OWNER } });
  const project = await prisma.project.upsert({ where: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, update: { name: 'Product Launch', organizationId: org.id }, create: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', organizationId: org.id, ownerId: user.id, name: 'Product Launch', description: 'Launch the next generation of the Nexora workspace.', status: ProjectStatus.ACTIVE, priority: Priority.HIGH, dueDate: new Date(Date.now() + 21 * 86400000) } });
  const backend = await prisma.task.upsert({ where: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, update: { projectId: project.id, organizationId: org.id }, create: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', organizationId: org.id, projectId: project.id, title: 'Complete backend API', description: 'Finish authentication, workspace scoping, and task endpoints.', status: TaskStatus.BLOCKED, priority: Priority.URGENT, assigneeId: user.id, dueDate: new Date(Date.now() - 86400000) } });
  const launch = await prisma.task.upsert({ where: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, update: { projectId: project.id, organizationId: org.id }, create: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', organizationId: org.id, projectId: project.id, title: 'Prepare launch checklist', description: 'Coordinate final release readiness across teams.', status: TaskStatus.TODO, priority: Priority.HIGH, dueDate: new Date(Date.now() + 12 * 86400000) } });
  await prisma.taskDependency.upsert({ where: { blockingTaskId_blockedTaskId: { blockingTaskId: backend.id, blockedTaskId: launch.id } }, update: {}, create: { organizationId: org.id, blockingTaskId: backend.id, blockedTaskId: launch.id } });
  console.log('Demo workspace ready: demo@nexora.local / NexoraDemo!2026');
}

main().finally(() => prisma.$disconnect());
