# 각 호기 봇

웹사이트/실행기와 같은 MongoDB의 호기 설정을 `HOST_ID`로 읽어 로그인하는 독립 호기 봇 템플릿입니다. 모든 호기는 이 코드의 별도 복사본을 각각 실행하고, 각 실행마다 서로 다른 `HOST_ID`를 설정합니다. 봇 토큰과 OAuth Client ID/Secret은 웹사이트의 호기 설정에서 관리합니다. 인증 완료 후 유저의 OAuth access/refresh token은 웹사이트 콜백이 같은 DB의 `RestoredUser` 컬렉션에 암호화 저장합니다.

## 설정

1. Node.js 22.12 이상을 설치하고 `npm install`을 실행합니다.
2. `.env.example`을 `.env`로 복사합니다.
3. 웹사이트에서 호기를 등록하고, 호기 목록에서 해당 `HOST_ID`를 복사합니다.
4. 실행기와 각 호기 프로젝트 `.env`에 같은 MongoDB URI와 `TOKEN_ENCRYPTION_KEY`를 설정합니다.
5. `PUBLIC_BASE_URL`을 공개 웹사이트 주소로 설정하고, 이 호기 `.env`의 `HOST_ID`에 복사한 ID를 입력합니다.
6. 실행기와 각 호기 프로젝트를 서로 다른 터미널에서 각각 시작합니다. 실행기는 웹사이트와 메인봇을, 각 호기 프로젝트는 자기 호기 봇만 실행합니다.

```powershell
npm install
npm start
```

## 명령어

- `/auth-panel channel:#채널`: 관리자 전용. 해당 호기의 OAuth 인증 링크가 있는 Components V2 패널을 게시합니다.
- 복구 명령은 메인봇의 `/recover license:<코드> server_id:<서버 ID>`에서 실행합니다. 승인 뒤 실행기가 공용 MongoDB 큐에 호기별 작업을 만들면, 이 봇 프로세스가 자기 호기 작업을 가져와 처리합니다.

각 호기는 온라인 상태를 15초마다 MongoDB에 기록하고, 자기 호기 작업만 2초 간격으로 확인합니다. 실행기는 45초 이상 갱신되지 않으면 해당 호기를 오프라인으로 판단합니다. 다른 호기를 운영할 때에는 이 프로젝트를 복사하고 `.env`의 `HOST_ID`를 해당 호기의 ID로 지정해 별도 프로세스로 실행합니다.
