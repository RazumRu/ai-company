export const PROJECT_DELETED_EVENT = 'project.deleted';

export interface ProjectDeletedEvent {
  projectId: string;
  userId: string;
}
