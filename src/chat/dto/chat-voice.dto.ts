import { IsInt, IsUUID, Max, Min } from 'class-validator';

// Somente identificadores: o texto narrado vem da mensagem persistida.
export class ChatVoiceDto {
  @IsUUID('4')
  conversationId!: string;

  @IsInt()
  @Min(1)
  @Max(4_294_967_295)
  messageId!: number;
}
