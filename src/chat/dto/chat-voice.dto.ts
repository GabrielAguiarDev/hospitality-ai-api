import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class ChatVoiceDto {
  @IsUUID('4')
  conversationId!: string;

  @IsInt()
  @Min(1)
  @Max(4_294_967_295)
  messageId!: number;
}
