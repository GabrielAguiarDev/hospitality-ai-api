import { InternalServerErrorException } from '@nestjs/common';

export function requireConfiguredResortId(
  value: string | undefined,
): string {
  const resortId = value?.trim();

  if (!resortId) {
    throw new InternalServerErrorException(
      'RESORT_ID não configurado no servidor.',
    );
  }

  return resortId;
}
