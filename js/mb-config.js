// 전역 네임스페이스 — 모든 모듈이 MB 아래에만 등록 (아임웹/외부 스크립트와 충돌 방지 습관 유지)
window.MB = window.MB || {};

MB.config = {
  // setup.html로 생성한 암호화 접속정보 블롭 { salt, iv, data } (base64).
  // null이면 게이트가 수동 입력 모드(개발용)로 동작한다.
  encryptedCreds: {
    salt: 'WZTQogLmcAUeWGacoOYEGA==',
    iv: 'FZOpZBxqmBCyGVb5',
    data: '550OykJYIBSuF7Dam1VVMkDKkj6uqy5KuMZXCnYnG4sq1am42e0cg9jlOSwTe8jnMyuUZpCuSfqwZpa/5rTnErXLN6jqJ2XbmR2aYDoeoAj8AXxeyX8I3E/gXpcucQIo3uey3Nxh176rjtdOGLffJTDRjZ6hUPGGklNwPNyIJQSUoYL9WD4JXFiArqC6J96Fz9fl0mGHSfp6NuY8nzjRCutFRAuMvYmM/wdr+b3eLNLYFlsGD3ir5DJTbvGVgCm5GCSdBynJ5eh5vMO/UgtNX74Sjh96nKpxCsm20PYOHzuzV5Si0Mp6rRqtjJVagV7bsUHmkZGkkgpkFe9B9KkrEr8kgXoty/XPR0uH/aJi3ReMvRt3ilXunYtlOg==',
  },

  // 정산 시작일 기본값 (앱 설정과 별개 — 웹 자체 값, 추후 설정 UI 추가)
  settlementDay: 1,

  // localStorage 키
  storageKeys: {
    creds: 'mb.creds.v1',
  },
};
