import JSEncrypt from 'jsencrypt';
import { RsaEncryptError } from './errors';

// Base64로 인코딩된 DER 공개키를 SPKI PEM 형식으로 래핑
function derToPem(base64DER: string): string {
  const lines = base64DER.match(/.{1,64}/g)?.join('\n') ?? base64DER;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

// 비밀번호를 RSA-PKCS#1 v1.5로 암호화하여 BASE64 문자열로 반환
// 모바일 앱(Dart `CPRSACrypto.encryptPassword`)과 동일한 흐름:
//   password(UTF-8 bytes) → RSA-PKCS1v15 encrypt → BASE64
// publicKeyBase64DER은 KMS API(`/open/v2/kms/public/{keyId}`)가 반환하는
// `publicKey` 필드 값(Base64 DER, SPKI 구조)을 그대로 넘겨주면 됨
export function encryptPasswordRSA(password: string, publicKeyBase64DER: string): string {
  const encrypt = new JSEncrypt();
  try {
    encrypt.setPublicKey(derToPem(publicKeyBase64DER));
  } catch (err) {
    throw new RsaEncryptError('Invalid RSA public key format', err);
  }
  const cipher = encrypt.encrypt(password);
  if (cipher === false) {
    throw new RsaEncryptError('RSA encryption failed — invalid public key or input too long');
  }
  return cipher;
}
