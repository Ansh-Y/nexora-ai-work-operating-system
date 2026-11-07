import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(10) @MaxLength(100) password!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) organizationName?: string;
  @IsOptional() @IsString() @MaxLength(128) inviteToken?: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(100) password!: string;
}
export class SwitchWorkspaceDto { @IsString() organizationId!: string; }
