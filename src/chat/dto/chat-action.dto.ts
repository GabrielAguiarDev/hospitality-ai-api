import { IsIn, IsUUID } from 'class-validator';

export const CHAT_ACTION_TYPES = [
  'experience.booking.confirm',
  'experience.booking.cancel',
] as const;

export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number];

// O cliente envia apenas referências; os dados da reserva
// são lidos da pré-reserva persistida no servidor.
export class ChatActionDto {
  @IsIn(CHAT_ACTION_TYPES)
  type!: ChatActionType;

  @IsUUID('4')
  conversationId!: string;

  @IsUUID('4')
  previewId!: string;
}
