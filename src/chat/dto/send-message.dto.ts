import { IsString, MaxLength, Matches, IsOptional, IsUUID} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @Matches(/\S/, {
    message: 'A mensagem não pode ser vazia.',
  })
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}