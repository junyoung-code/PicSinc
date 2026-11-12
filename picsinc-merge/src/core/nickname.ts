// Names show on small cards and on labels over the photo, so they stay short (B-018).
// The DB still accepts up to 40, so rooms made before this limit keep working.
export const NICKNAME_MAX_LENGTH = 12;
export const nicknameLengthMessage = `닉네임은 1~${NICKNAME_MAX_LENGTH}자로 입력하세요.`;
