import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchDto {
  @IsString() @MinLength(2) @MaxLength(240) q!: string;
}
