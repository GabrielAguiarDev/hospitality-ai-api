
import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class AskOperationsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message!: string;
}
