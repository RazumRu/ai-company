import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('github_app_installations')
@Unique(['userId', 'installationId'])
export class GitHubAppInstallationEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  @Index()
  userId!: string;

  @Column({ type: 'int' })
  @Index()
  installationId!: number;

  @Column({ type: 'varchar' })
  accountLogin!: string;

  @Column({ type: 'varchar' })
  accountType!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
