import { IsString, IsUUID, Matches } from 'class-validator';

export class LinkGitHubRepositoryDto {
  @IsString() @Matches(/^\d{1,20}$/) repositoryId!: string;
  @IsUUID() projectId!: string;
}

export class WebhookRepositoryDto {
  @IsUUID() repositoryId!: string;
}
