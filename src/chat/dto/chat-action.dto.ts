import { IsIn, IsUUID } from 'class-validator';

export const CHAT_ACTION_TYPES = [
  'experience.booking.confirm',
  'experience.booking.cancel',
  'request.confirm',
  'request.cancel',
] as const;

export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number];

export class ChatActionDto {
  @IsIn(CHAT_ACTION_TYPES)
  type!: ChatActionType;

  @IsUUID('4')
  conversationId!: string;

  @IsUUID('4')
  previewId!: string;
}
