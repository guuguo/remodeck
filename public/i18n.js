export const LOCALE_STORAGE_KEY = "ac.locale";

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

const SUPPORTED_CODE_SET = new Set(SUPPORTED_LOCALES.map((item) => item.code));

export function normalizeLocale(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (SUPPORTED_CODE_SET.has(value)) return value;
  const lower = value.toLowerCase();
  if (lower.startsWith("zh-hant") || lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo") {
    return "zh-TW";
  }
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("en")) return "en";
  return "";
}

export function detectInitialLocale(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (typeof window !== "undefined" && window.location?.search) {
      const fromUrl = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
      if (fromUrl) return fromUrl;
    }
  } catch {}
  try {
    const saved = normalizeLocale(storage?.getItem?.(LOCALE_STORAGE_KEY));
    if (saved) return saved;
  } catch {}
  try {
    const navLang = typeof navigator !== "undefined" ? navigator.language || navigator.languages?.[0] : "";
    const detected = normalizeLocale(navLang);
    if (detected) return detected;
  } catch {}
  return "en";
}

// Keyed by exact Simplified Chinese source text so existing templates work without invasive rewrites.
const DICTIONARY = {
  "问{name}：等你拍板的是哪一步？或者说‘派工…’": { en: "Ask about {name}: which decision is waiting? Or say “dispatch…”" },
  "问{name}：这轮收菜的依据是什么？或者说‘派工…’": { en: "Ask about {name}: what is ready for review? Or say “dispatch…”" },
  "问{name}：上次停在哪？或者说‘派工…’": { en: "Ask about {name}: where did it stop? Or say “dispatch…”" },
  "{name}上次停下还没收尾，接着做还是先搁着？": { en: "{name} has unfinished work. Continue or park it?" },
  "园区工单": { en: "Park tasks" },
  "园区任务": { en: "Park tasks" },
  "等你": { en: "Waiting" },
  "收菜": { en: "Harvest" },
  "烂尾": { en: "Unfinished" },
  "更多": { en: "More" },
  "小精灵记忆": { en: "Sprite memory" },
  "查看别名": { en: "View aliases" },
  "一键清空": { en: "Clear memory" },
  "暂无别名": { en: "No aliases yet" },
  "续做语": { en: "Continuation message" },
  "发送续做": { en: "Send continuation" },
  "续做": { en: "Continue" },
  "稍后": { en: "Later" },
  "好，记为完成": { en: "Got it, marked done" },
  "先搁着，有新动静再说": { en: "Parked until something changes" },
  "明早 8 点再提醒你": { en: "I'll remind you at 8 AM tomorrow" },
  "这条以后不再提醒": { en: "Won't remind you about this again" },
  "已发回原工位接着做": { en: "Sent back to the original thread" },
  "搁置": { en: "Park" },
  "完成": { en: "Done" },
  "不用提醒": { en: "Dismiss" },
  "下一站": { en: "Next stop" },
  "跳过": { en: "Skip" },
  "结束": { en: "End" },
  "修改": { en: "Edit" },
  "原工位": { en: "existing station" },
  "新工位": { en: "new station" },
  "未指定产线": { en: "unspecified line" },
  "归档历史": { en: "Archive history" },
  "去看看": { en: "Take a look" },
  "{name}还在等你拍板，先给它一句话？": { en: "{name} is waiting for your decision. Take a look first?" },
  "{name}有菜可收，先验一下这轮产出？": { en: "{name} has output ready. Review this round first?" },
  "园子很太平，最久没动的是{name}，去看看？": { en: "The park is quiet. {name} has been idle the longest. Take a look?" },
  "园区暂时没有工单，等产线有动静我再报。": { en: "No work orders in the park. I will report when a line changes." },
  "{count} 名 AI 员工正在运转": { en: "{count} AI workers are active" },
  "问答请求失败（{status}）": { en: "Question request failed ({status})" },
  "没有收到回答，请重试。": { en: "No answer received. Please retry." },
  "问{name}：做到哪了？卡在哪？或者说‘派工…’": { en: "Ask about {name}: progress or blockers? Or say “dispatch…”" },
  "问我任何产线的进度，或者说‘派工…’": { en: "Ask about any production line, or say “dispatch…”" },
  "做到哪了": { en: "How far along is it?" },
  "卡在哪": { en: "What is blocking it?" },
  "接着做": { en: "Continue from where it stopped" },
  "历史": { en: "History" },
  "去拍板": { en: "Show pending decisions" },
  "去收菜": { en: "Show harvests" },
  "我忘了什么": { en: "What did I forget?" },
  "汇报进展": { en: "Report progress" },
  "我理解为：让 {agent} 在 {topic}（{station}）做 {task}，这样派吗？": { en: "My understanding: have {agent} work on {task} in {topic} ({station}). Dispatch?" },
  "正在收听语音，也可随时打字发送…": { en: "Listening. You can also type a message…" },
  "说「确认」执行，或输入新指令…": { en: "Say “confirm” to proceed, or enter a new instruction…" },
  "问答暂时不可用：{error}": { en: "Questions are unavailable: {error}" },
  "巡园暂时不可用：{error}": { en: "Tour is unavailable: {error}" },
  "接着上次停下的地方继续：{line}": { en: "Continue from where you stopped: {line}" },
  "有 {count} 筐可收（依据：{evidence}）": { en: "{count} harvests ready (evidence: {evidence})" },
  "看阶段快能收菜了（推测）": { en: "Looks almost ready to harvest based on its stage (inferred)" },
  "跑完一轮，等你收菜": { en: "Finished a round, awaiting your review" },
  "工单": { en: "Task" },
  "任务": { en: "Task" },
  "目标": { en: "Goal" },
  "还没定验收标准": { en: "No acceptance criteria yet" },
  "重试": { en: "Retry" },
  "钉成工单": { en: "Pin as task" },
  "钉成任务": { en: "Pin as task" },
  "放弃工单": { en: "Drop task" },
  "放弃任务": { en: "Drop task" },
  "已重新唤起定时任务": { en: "Scheduled task started again" },
  "工单已放弃": { en: "Task dropped" },
  "任务已放弃": { en: "Task dropped" },
  "已钉成工单：{title}": { en: "Pinned as task: {title}" },
  "已钉成任务：{title}": { en: "Pinned as task: {title}" },
  "验收标准 {count} 条": { en: "{count} acceptance criteria" },
  "还没有工单。在会话顶栏「更多」里点「钉成工单」，或在提醒卡上点「钉成工单」。": { en: "No tasks yet. Use “Pin as task” in the thread's More menu or on a reminder card." },
  "还没有任务。在会话顶栏「更多」里点「钉成任务」，或在提醒卡上点「钉成任务」。": { en: "No tasks yet. Use “Pin as task” in the thread's More menu or on a reminder card." },
  "还没有工单。": { en: "No tasks yet." },
  "还没有任务。": { en: "No tasks yet." },
  "打开：{title}": { en: "Open: {title}" },
  "改验收：{title}": { en: "Edit criteria: {title}" },
  "共 {count} 张进行中的工单：": { en: "{count} open tasks:" },
  "共 {count} 项进行中的任务：": { en: "{count} open tasks:" },
  "共有 {count} 张工单，第一张：{line}": { en: "{count} tasks. First: {line}" },
  "共有 {count} 项任务，第一项：{line}": { en: "{count} tasks. First: {line}" },
  "验收标准，一行一条（留空表示不设）：": { en: "Acceptance criteria, one per line (leave empty for none):" },
  "工单「{title}」的验收标准已更新": { en: "Updated acceptance criteria for “{title}”" },
  "任务「{title}」的验收标准已更新": { en: "Updated acceptance criteria for “{title}”" },
  "钉成工单失败": { en: "Could not pin as task" },
  "钉成任务失败": { en: "Could not pin as task" },
  "免提": { en: "Hands-free" },
  "免提中": { en: "Hands-free on" },
  "已是工单": { en: "Pinned" },
  "已是任务": { en: "Pinned" },
  "设为规划": { en: "Pin plan" },
  "关联会话": { en: "Link session" },
  "子任务": { en: "Subtask" },
  "任务管理": { en: "Tasks" },
  "小精灵": { en: "Sprite" },
  "全屏": { en: "Fullscreen" },
  "电话": { en: "Call" },
  "打语音电话": { en: "Voice Call" },
  "回到通话": { en: "Return to Call" },
  "新对话": { en: "New Chat" },
  "小精灵 AI 助手": { en: "Sprite AI Assistant" },
  "小精灵电话": { en: "Sprite Call" },
  "免确认直发": { en: "Auto-Run" },
  "写前先确认": { en: "Ask First" },
  "文字记录": { en: "Transcript" },
  "收起": { en: "Minimize" },
  "静音": { en: "Mute" },
  "开麦": { en: "Unmute" },
  "键盘": { en: "Keyboard" },
  "挂断": { en: "Hang up" },
  "重播": { en: "Replay" },
  "播进展": { en: "Briefing" },
  "我将为你执行以下操作": { en: "Ready to run this action" },
  "可点确认，或直接说「确认」": { en: "Tap confirm or say “confirm”" },
  "确认执行": { en: "Confirm & Run" },
  "执行中…": { en: "Running…" },
  "自动优选模型": { en: "Auto Best Model" },

  "RemoteDeck · 多智能体远程控制台": {
    en: "RemoteDeck · Multi-Agent Remote Console",
    "zh-TW": "RemoteDeck · 多智慧體遠端控制台",
    ja: "RemoteDeck · マルチエージェント・リモートコンソール",
    ko: "RemoteDeck · 멀티 에이전트 원격 콘솔",
  },
  "本机": { en: "Local", "zh-TW": "本機", ja: "ローカル", ko: "로컬" },
  "+ 新建会话": { en: "+ New Session", "zh-TW": "+ 新增會話", ja: "+ 新規セッション", ko: "+ 새 세션" },
  "面板": { en: "Board", "zh-TW": "面板", ja: "ボード", ko: "보드" },
  "远程": { en: "Remote", "zh-TW": "遠端", ja: "リモート", ko: "원격" },
  "全部": { en: "All", "zh-TW": "全部", ja: "すべて", ko: "전체" },
  "多选": { en: "Select", "zh-TW": "多選", ja: "選択", ko: "선택" },
  "有更新": { en: "Update", "zh-TW": "有更新", ja: "更新あり", ko: "업데이트" },
  "自动更新": { en: "Auto-update", "zh-TW": "自動更新", ja: "自動更新", ko: "자동 업데이트" },
  "选择一个会话或新建任务": {
    en: "Select a session or start a new task",
    "zh-TW": "選擇一個會話或新增任務",
    ja: "セッションを選択するか新規タスクを開始",
    ko: "세션을 선택하거나 새 작업을 시작하세요",
  },
  "额度": { en: "Quota", "zh-TW": "額度", ja: "クォータ", ko: "할당량" },
  "通话": { en: "Voice", "zh-TW": "通話", ja: "音声", ko: "음성" },
  "朗读": { en: "Read", "zh-TW": "朗讀", ja: "読上", ko: "읽기" },
  "朗读播报": { en: "Read Aloud", "zh-TW": "朗讀播報", ja: "音声読み上げ", ko: "음성 읽어주기" },
  "按住 说话": { en: "Hold to Talk", "zh-TW": "按住 說話", ja: "押して話す", ko: "길게 눌러 말하기" },
  "松开 发送（上滑取消）": {
    en: "Release to Send (Slide up to cancel)",
    "zh-TW": "放開 傳送（上滑取消）",
    ja: "離して送信（上スライドで取消）",
    ko: "놓아서 전송 (위로 밀어 취소)",
  },
  "松开手指 取消发送": {
    en: "Release to Cancel",
    "zh-TW": "放開手指 取消傳送",
    ja: "指を離してキャンセル",
    ko: "손을 떼면 취소",
  },
  "正在识别并发送…": {
    en: "Transcribing & sending…",
    "zh-TW": "正在辨識並傳送…",
    ja: "音声認識して送信中…",
    ko: "음성 인식 및 전송 중…",
  },
  "切换回键盘输入": {
    en: "Switch to keyboard",
    "zh-TW": "切換回鍵盤輸入",
    ja: "キーボード入力に戻す",
    ko: "키보드 입력으로 전환",
  },
  "中断": { en: "Stop", "zh-TW": "中斷", ja: "停止", ko: "중단" },
  "中断当前执行": { en: "Interrupt current run", "zh-TW": "中斷目前執行", ja: "現在の実行を中断", ko: "현재 실행 중단" },
  "更多操作": { en: "More actions", "zh-TW": "更多操作", ja: "その他の操作", ko: "더 보기" },
  "关注项目": { en: "Pin Project", "zh-TW": "關注專案", ja: "プロジェクトを固定", ko: "프로젝트 고정" },
  "同目录新任务": { en: "New Task Here", "zh-TW": "同目錄新任務", ja: "同フォルダで新規タスク", ko: "이 폴더에서 새 작업" },
  "开启 Goal": { en: "Enable Goal", "zh-TW": "開啟 Goal", ja: "Goal を有効化", ko: "Goal 켜기" },
  "已开启 Goal": { en: "Goal Active", "zh-TW": "已開啟 Goal", ja: "Goal 有効", ko: "Goal 활성" },
  "重命名": { en: "Rename", "zh-TW": "重新命名", ja: "名前変更", ko: "이름 변경" },
  "加载本会话预览图": { en: "Load session previews", "zh-TW": "載入本會話預覽圖", ja: "プレビュー画像を読み込む", ko: "세션 미리보기 로드" },
  "归档": { en: "Archive", "zh-TW": "封存", ja: "アーカイブ", ko: "보관" },
  "刷新": { en: "Refresh", "zh-TW": "重新整理", ja: "更新", ko: "새로고침" },
  "刷新当前视图": { en: "Refresh current view", "zh-TW": "重新整理目前檢視", ja: "現在のビューを更新", ko: "현재 보기 새로고침" },
  "刷新列表": { en: "Refresh list", "zh-TW": "重新整理列表", ja: "リストを更新", ko: "목록 새로고침" },
  "定时任务": { en: "Automations", "zh-TW": "排程任務", ja: "定期タスク", ko: "예약 작업" },
  "版本与更新": { en: "Version & Updates", "zh-TW": "版本與更新", ja: "バージョンと更新", ko: "버전 및 업데이트" },
  "执行中": { en: "Running", "zh-TW": "執行中", ja: "実行中", ko: "실행 중" },
  "加载更早对话": { en: "Load earlier messages", "zh-TW": "載入更早對話", ja: "以前のメッセージを読み込む", ko: "이전 대화 불러오기" },
  "加载中…": { en: "Loading…", "zh-TW": "載入中…", ja: "読み込み中…", ko: "불러오는 중…" },
  "发送": { en: "Send", "zh-TW": "傳送", ja: "送信", ko: "전송" },
  "立即发送": { en: "Send Now", "zh-TW": "立即傳送", ja: "今すぐ送信", ko: "즉시 전송" },
  "排队": { en: "Queue", "zh-TW": "排隊", ja: "キュー", ko: "대기열" },
  "插话": { en: "Steer", "zh-TW": "插話", ja: "割り込み", ko: "끼어들기" },
  "取消": { en: "Cancel", "zh-TW": "取消", ja: "キャンセル", ko: "취소" },
  "关闭": { en: "Close", "zh-TW": "關閉", ja: "閉じる", ko: "닫기" },
  "复制": { en: "Copy", "zh-TW": "複製", ja: "コピー", ko: "복사" },
  "复制命令": { en: "Copy command", "zh-TW": "複製指令", ja: "コマンドをコピー", ko: "명령 복사" },
  "下载": { en: "Download", "zh-TW": "下載", ja: "ダウンロード", ko: "다운로드" },
  "清除": { en: "Clear", "zh-TW": "清除", ja: "クリア", ko: "지우기" },
  "输入指令…": { en: "Type a prompt…", "zh-TW": "輸入指令…", ja: "プロンプトを入力…", ko: "명령을 입력하세요…" },
  "输入你想让智能体立即开始的任务…": {
    en: "Describe the task to start immediately…",
    "zh-TW": "輸入你想讓智慧體立即開始的任務…",
    ja: "エージェントに開始させるタスクを入力…",
    ko: "에이전트에게 바로 시작할 작업을 입력하세요…",
  },
  "只读 / 询问": { en: "Read-only / Ask", "zh-TW": "唯讀 / 詢問", ja: "読み取り専用 / 確認", ko: "읽기 전용 / 묻기" },
  "只读 / 每次询问": { en: "Read-only / Ask every time", "zh-TW": "唯讀 / 每次詢問", ja: "読み取り専用 / 毎回確認", ko: "읽기 전용 / 매번 묻기" },
  "自动安全命令 (Auto)": { en: "Auto safe commands", "zh-TW": "自動安全指令 (Auto)", ja: "安全なコマンドを自動実行", ko: "안전 명령 자동 실행" },
  "工作区读写": { en: "Workspace Read/Write", "zh-TW": "工作區讀寫", ja: "ワークスペース読み書き", ko: "작업 공간 읽기/쓰기" },
  "工作区读写（命令询问）": { en: "Workspace R/W (Ask cmds)", "zh-TW": "工作區讀寫（指令詢問）", ja: "ワークスペースR/W（コマンド確認）", ko: "작업 공간 R/W (명령 확인)" },
  "Turbo（自动批准）": { en: "Turbo (Auto-approve)", "zh-TW": "Turbo（自動核准）", ja: "Turbo（自動承認）", ko: "Turbo (자동 승인)" },
  "Turbo（自动批准全权限）": { en: "Turbo (Full auto-approve)", "zh-TW": "Turbo（自動核准全權限）", ja: "Turbo（全権限自動承認）", ko: "Turbo (전체 자동 승인)" },
  "仅规划 (Plan)": { en: "Plan only", "zh-TW": "僅規劃 (Plan)", ja: "計画のみ (Plan)", ko: "계획만 (Plan)" },
  "智能体": { en: "Agent", "zh-TW": "智慧體", ja: "エージェント", ko: "에이전트" },
  "实例": { en: "Profile", "zh-TW": "實例", ja: "プロファイル", ko: "프로필" },
  "模型": { en: "Model", "zh-TW": "模型", ja: "モデル", ko: "모델" },
  "思考强度": { en: "Reasoning", "zh-TW": "思考強度", ja: "推論強度", ko: "추론 강도" },
  "推理强度": { en: "Reasoning", "zh-TW": "推理強度", ja: "推論強度", ko: "추론 강도" },
  "权限模式": { en: "Permissions", "zh-TW": "權限模式", ja: "権限モード", ko: "권한 모드" },
  "工作目录": { en: "Working Dir", "zh-TW": "工作目錄", ja: "作業ディレクトリ", ko: "작업 디렉토리" },
  "工作目录（CWD）": { en: "Working Directory (CWD)", "zh-TW": "工作目錄（CWD）", ja: "作業ディレクトリ (CWD)", ko: "작업 디렉토리 (CWD)" },
  "留空使用用户主目录": { en: "Leave blank for home directory", "zh-TW": "留空使用使用者主目錄", ja: "空欄でホームディレクトリを使用", ko: "비워 두면 홈 디렉토리 사용" },
  "首条任务指令（可选）": { en: "Initial prompt (optional)", "zh-TW": "首條任務指令（可選）", ja: "最初のプロンプト（任意）", ko: "첫 작업 지시 (선택)" },
  "创建会话": { en: "Create Session", "zh-TW": "建立會話", ja: "セッションを作成", ko: "세션 만들기" },
  "新建远程会话": { en: "New Remote Session", "zh-TW": "新增遠端會話", ja: "新規リモートセッション", ko: "새 원격 세션" },
  "新建接续会话": { en: "Continue in New Session", "zh-TW": "新增接續會話", ja: "引き継ぎセッションを作成", ko: "이어하기 세션 만들기" },
  "手机远程配对与隧道": { en: "Mobile Remote & Tunnel", "zh-TW": "手機遠端配對與通道", ja: "モバイル接続 & トンネル", ko: "모바일 원격 연결 및 터널" },
  "一键免费隧道": { en: "Quick Free Tunnel", "zh-TW": "一鍵免費通道", ja: "ワンクリック無料トンネル", ko: "원클릭 무료 터널" },
  "一键免费隧道（免注册 · 临时扫码）": { en: "Quick Free Tunnel (Zero-signup · QR)", "zh-TW": "一鍵免費通道（免註冊 · 臨時掃碼）", ja: "無料クイックトンネル（登録不要 · QR）", ko: "무료 퀵 터널 (가입 불필요 · QR)" },
  "一键开启并生成二维码": { en: "Start Tunnel & Show QR", "zh-TW": "一鍵開啟並產生 QR Code", ja: "トンネル開始 & QRコード生成", ko: "터널 시작 및 QR 생성" },
  "关闭隧道": { en: "Stop Tunnel", "zh-TW": "關閉通道", ja: "トンネル停止", ko: "터널 중지" },
  "重置二维码": { en: "Reset QR Code", "zh-TW": "重設 QR Code", ja: "QRコード再発行", ko: "QR 코드 재설정" },
  "一键开启 Tailscale Funnel": { en: "Enable Tailscale Funnel", "zh-TW": "一鍵開啟 Tailscale Funnel", ja: "Tailscale Funnel を有効化", ko: "Tailscale Funnel 켜기" },
  "关闭 Funnel": { en: "Disable Funnel", "zh-TW": "關閉 Funnel", ja: "Funnel を無効化", ko: "Funnel 끄기" },
  "生成固定链接配对二维码": { en: "Generate Permanent QR", "zh-TW": "產生固定連結 QR Code", ja: "固定URL用QRコード生成", ko: "고정 URL QR 생성" },
  "配对并连接中继": { en: "Pair & Connect Relay", "zh-TW": "配對並連線中繼", ja: "リレーに接続・ペアリング", ko: "릴레이 페어링 및 연결" },
  "断开并撤销凭证": { en: "Disconnect & Revoke", "zh-TW": "中斷並撤銷憑證", ja: "切断して認証を失効", ko: "연결 해제 및 인증 취소" },
  "版本与自动更新": { en: "Version & Auto-Update", "zh-TW": "版本與自動更新", ja: "バージョンと自動更新", ko: "버전 및 자동 업데이트" },
  "当前运行版本": { en: "Current Version", "zh-TW": "目前執行版本", ja: "現在のバージョン", ko: "현재 실행 버전" },
  "待更新内容": { en: "Pending Changes", "zh-TW": "待更新內容", ja: "更新内容", ko: "업데이트 내역" },
  "立即检查": { en: "Check Now", "zh-TW": "立即檢查", ja: "今すぐ確認", ko: "지금 확인" },
  "一键更新并重启": { en: "Update & Restart", "zh-TW": "一鍵更新並重啟", ja: "更新して再起動", ko: "업데이트 및 재시작" },
  "重启服务": { en: "Restart Service", "zh-TW": "重啟服務", ja: "サービス再起動", ko: "서비스 재시작" },
  "更新桌面 App": { en: "Update Desktop App", "zh-TW": "更新桌面 App", ja: "デスクトップAppを更新", ko: "데스크톱 앱 업데이트" },
  "自动更新策略": { en: "Auto-Update Policy", "zh-TW": "自動更新策略", ja: "自動更新ポリシー", ko: "자동 업데이트 정책" },
  "定期自动检测新版本": { en: "Check for updates periodically", "zh-TW": "定期自動偵測新版本", ja: "新しいバージョンを定期確認", ko: "새 버전 주기적 자동 확인" },
  "AGY 发送前自动压缩上下文": { en: "Auto-compact AGY context before sending", "zh-TW": "AGY 傳送前自動壓縮上下文", ja: "AGY 送信前にコンテキストを自動圧縮", ko: "AGY 전송 전 컨텍스트 자동 압축" },
  "上下文较上次压缩增长超过阈值时，先执行 /compact 再发送消息，节省周额度": { en: "When context grows past the threshold since the last compaction, run /compact before sending to save weekly quota", "zh-TW": "上下文較上次壓縮增長超過閾值時，先執行 /compact 再傳送訊息，節省週額度", ja: "前回の圧縮からコンテキストが閾値を超えて増えたら、送信前に /compact を実行して週間クォータを節約", ko: "마지막 압축 이후 컨텍스트가 임계값을 넘으면 전송 전에 /compact 를 실행해 주간 할당량을 절약" },
  "AGY 遇到瞬时 401 自动续发一次继续": { en: "Auto-continue once on transient AGY 401 error", "zh-TW": "AGY 遇到瞬時 401 自動續發一次繼續", ja: "AGY の一時的な 401 エラー時に1回自動続行", ko: "AGY 일시적 401 오류 시 1회 자동 계속 전송" },
  "每小时 OAuth 令牌刷新间隙触发 401 中断时，延迟 2.5 秒自动补发一次「继续」（单轮最多 1 次）": { en: "When hourly OAuth refresh causes a transient 401 stop, wait 2.5s and automatically send \"Continue\" once per turn", "zh-TW": "每小時 OAuth 權杖重新整理間隙觸發 401 中斷時，延遲 2.5 秒自動補發一次「繼續」（單輪最多 1 次）", ja: "毎時の OAuth トークン更新の合間に一時的な 401 中断が発生した際、2.5秒待って1回だけ自動で「続行」を送信します（1ターン最大1回）", ko: "매시간 OAuth 토큰 갱신 틈새에 일시적 401 중단이 발생하면 2.5초 후 자동으로 '계속'을 1회 전송합니다(턴당 최대 1회)" },
  "闲时自动更新并重启服务": { en: "Auto-update & restart when idle", "zh-TW": "閒置時自動更新並重啟服務", ja: "アイドル時に自動更新・再起動", ko: "유휴 시 자동 업데이트 및 재시작" },
  "同步更新 macOS 桌面 App 壳子": { en: "Sync macOS Desktop App wrapper", "zh-TW": "同步更新 macOS 桌面 App 外殼", ja: "macOS デスクトップAppも同期更新", ko: "macOS 데스크톱 앱 래퍼 동기화" },
  "开车 / 免提语音通话": { en: "Hands-Free Voice Control", "zh-TW": "開車 / 免持語音通話", ja: "ハンズフリー音声コントロール", ko: "핸즈프리 음성 제어" },
  "语音通话控制球": { en: "Voice Control Orb", "zh-TW": "語音通話控制球", ja: "音声コントロールオーブ", ko: "음성 제어 오브" },
  "看对话": { en: "View Chat", "zh-TW": "看對話", ja: "チャットを見る", ko: "대화 보기" },
  "静音": { en: "Mute", "zh-TW": "靜音", ja: "ミュート", ko: "음소거" },
  "挂断": { en: "Hang Up", "zh-TW": "掛斷", ja: "通話終了", ko: "통화 종료" },
  "展开文字输入": { en: "Text Input", "zh-TW": "展開文字輸入", ja: "テキスト入力", ko: "텍스트 입력" },
  "播报进度": { en: "Announce Progress", "zh-TW": "播報進度", ja: "進捗を読み上げ", ko: "진행 상황 안내" },
  "后台任务完成或新审批时自动语音播报": {
    en: "Auto-announce task completions and approvals",
    "zh-TW": "背景任務完成或新核准時自動語音播報",
    ja: "タスク完了や承認待ちを自動で音声通知",
    ko: "백그라운드 작업 완료 및 승인 요청 자동 음성 안내",
  },
  "Agent 定时任务与后台唤起": { en: "Scheduled Tasks & Automations", "zh-TW": "Agent 排程任務與背景喚起", ja: "定期タスクとバックグラウンド実行", ko: "에이전트 예약 작업 및 백그라운드 실행" },
  "保存并启用托管": { en: "Save & Enable", "zh-TW": "儲存並啟用託管", ja: "保存して有効化", ko: "저장 및 활성화" },
  "测通": { en: "Test", "zh-TW": "測通", ja: "テスト", ko: "테스트" },
  "添加图片": { en: "Attach Image", "zh-TW": "加入圖片", ja: "画像を添付", ko: "이미지 첨부" },
  "语言 / Language": { en: "Language", "zh-TW": "語言 / Language", ja: "言語 / Language", ko: "언어 / Language" },
  "等待审批": { en: "Needs Approval", "zh-TW": "等待核准", ja: "承認待ち", ko: "승인 대기" },
  "允许": { en: "Allow", "zh-TW": "允許", ja: "許可", ko: "허용" },
  "拒绝": { en: "Deny", "zh-TW": "拒絕", ja: "拒否", ko: "거부" },
  "始终允许": { en: "Always Allow", "zh-TW": "一律允許", ja: "常に許可", ko: "항상 허용" },
  "已完成": { en: "Done", "zh-TW": "已完成", ja: "完了", ko: "완료" },
  "已中断": { en: "Interrupted", "zh-TW": "已中斷", ja: "中断済み", ko: "중단됨" },
  "已归档": { en: "Archived", "zh-TW": "已封存", ja: "アーカイブ済み", ko: "보관됨" },
  "项目总控面板": { en: "Project Control Board", "zh-TW": "專案總控面板", ja: "プロジェクト統合ボード", ko: "프로젝트 제어 보드" },
  "运行中": { en: "Running", "zh-TW": "執行中", ja: "実行中", ko: "실행 중" },
  "待命": { en: "Idle", "zh-TW": "待命", ja: "待機中", ko: "대기 중" },
  "目标自动推进": { en: "Auto-advance Goal", "zh-TW": "目標自動推進", ja: "ゴール自動進行", ko: "목표 자동 진행" },
  "实时连接状态": { en: "Live connection status", "zh-TW": "即時連線狀態", ja: "リアルタイム接続状態", ko: "실시간 연결 상태" },
  "打开手机远程控制": { en: "Open Mobile Remote Control", "zh-TW": "開啟手機遠端控制", ja: "モバイルリモートを開く", ko: "모바일 원격 제어 열기" },
  "AI 开车 / 免提语音通话总控": { en: "Hands-Free AI Voice Console", "zh-TW": "AI 開車 / 免持語音通話總控", ja: "ハンズフリー AI 音声コントロール", ko: "핸즈프리 AI 음성 제어" },
  "图片大图预览": { en: "Image Preview", "zh-TW": "圖片大圖預覽", ja: "画像プレビュー", ko: "이미지 미리보기" },
  "文件预览": { en: "File Preview", "zh-TW": "檔案預覽", ja: "ファイルプレビュー", ko: "파일 미리보기" },
  "原图新窗": { en: "Open Original", "zh-TW": "原圖新視窗", ja: "元の画像を新しいタブで開く", ko: "원본 새 창에서 열기" },
  "重置缩放": { en: "Reset Zoom", "zh-TW": "重設縮放", ja: "ズームをリセット", ko: "확대/축소 초기화" },
  "加载原图": { en: "Load Full Image", "zh-TW": "載入原圖", ja: "元画像を読み込む", ko: "원본 이미지 불러오기" },
  "换 Agent 继续": { en: "Continue with Another Agent", "zh-TW": "換 Agent 繼續", ja: "別のエージェントで続行", ko: "다른 에이전트로 계속" },
  "开启后将在未出现完成标记时自动推进": {
    en: "Automatically continue turns until completion marker appears",
    "zh-TW": "開啟後將在未出現完成標記時自動推進",
    ja: "完了マーカーが出るまで自動で次のターンを継続",
    ko: "완료 표시가 나올 때까지 자동으로 다음 턴을 계속 실행",
  },
  "选择工作目录（默认主目录）": {
    en: "Choose working directory (default: home)",
    "zh-TW": "選擇工作目錄（預設主目錄）",
    ja: "作業ディレクトリを選択（デフォルト：ホーム）",
    ko: "작업 디렉토리 선택 (기본값: 홈)",
  },
  "搜索项目或输入目录路径…": {
    en: "Search projects or enter directory path…",
    "zh-TW": "搜尋專案或輸入目錄路徑…",
    ja: "プロジェクトを検索またはパスを入力…",
    ko: "프로젝트 검색 또는 디렉토리 경로 입력…",
  },
  "浏览…": { en: "Browse…", "zh-TW": "瀏覽…", ja: "参照…", ko: "찾아보기…" },
  "从本机选择文件夹": {
    en: "Choose folder on host machine",
    "zh-TW": "從本機選擇資料夾",
    ja: "ホストPCからフォルダを選択",
    ko: "호스트에서 폴더 선택",
  },
  "默认工作区（用户主目录）": {
    en: "Default Workspace (Home Directory)",
    "zh-TW": "預設工作區（使用者主目錄）",
    ja: "デフォルト作業スペース（ホームディレクトリ）",
    ko: "기본 작업 공간 (홈 디렉토리)",
  },
  "使用此目录路径": {
    en: "Use this directory path",
    "zh-TW": "使用此目錄路徑",
    ja: "このディレクトリパスを使用",
    ko: "이 디렉토리 경로 사용",
  },
  "选择工作目录": {
    en: "Choose Working Directory",
    "zh-TW": "選擇工作目錄",
    ja: "作業ディレクトリを選択",
    ko: "작업 디렉토리 선택",
  },
  "点击选择或切换新会话的工作目录": {
    en: "Click to choose or switch the working directory for this new session",
    "zh-TW": "點擊選擇或切換新會話的工作目錄",
    ja: "クリックして新規セッションの作業ディレクトリを選択・切替",
    ko: "클릭하여 새 세션의 작업 디렉토리를 선택하거나 전환",
  },
  "没有匹配的项目，可直接输入完整目录路径后按回车使用": {
    en: "No matching projects; enter a full directory path and press Enter",
    "zh-TW": "沒有符合的專案，可直接輸入完整目錄路徑後按 Enter 使用",
    ja: "一致するプロジェクトがありません。フルパスを入力して Enter を押してください",
    ko: "일치하는 프로젝트가 없습니다. 전체 디렉토리 경로를 입력하고 Enter를 누르세요",
  },
  "搜索标题、对话内容或项目…": {
    en: "Search titles, chat content, or projects…",
    "zh-TW": "搜尋標題、對話內容或專案…",
    ja: "タイトル、会話内容、プロジェクトを検索…",
    ko: "제목, 대화 내용 또는 프로젝트 검색…",
  },
  "输入项目名、简称、标题或对话内容关键词…": {
    en: "Filter by project, alias, title, or chat content…",
    "zh-TW": "輸入專案名、簡稱、標題或對話內容關鍵詞…",
    ja: "プロジェクト名、別名、タイトル、会話内容で絞り込み…",
    ko: "프로젝트명, 별칭, 제목 또는 대화 내용 키워드로 필터…",
  },
  "正在检索历史对话内容…": {
    en: "Searching chat history…",
    "zh-TW": "正在搜尋歷史對話內容…",
    ja: "会話履歴を検索中…",
    ko: "대화 기록 검색 중…",
  },
  "正在搜索历史对话内容…": {
    en: "Searching chat history…",
    "zh-TW": "正在搜尋歷史對話內容…",
    ja: "会話履歴を検索中…",
    ko: "대화 기록 검색 중…",
  },
  "后台建立历史正文索引中…": {
    en: "Indexing chat history in background…",
    "zh-TW": "背景建立歷史正文索引中…",
    ja: "会話履歴インデックスをバックグラウンド構築中…",
    ko: "백그라운드에서 대화 기록 인덱싱 중…",
  },
  "请稍候，正在扫描历史对话正文…": {
    en: "Scanning chat history content…",
    "zh-TW": "請稍候，正在掃描歷史對話正文…",
    ja: "会話履歴本文をスキャン中…",
    ko: "대화 기록 본문을 스캔하는 중…",
  },
};

let currentLocale = detectInitialLocale();

export function getLocale() {
  return currentLocale;
}

export function translateText(raw, locale = currentLocale) {
  if (!raw || typeof raw !== "string") return raw;
  if (locale === "zh-CN") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  const entry = DICTIONARY[trimmed];
  if (!entry) return raw;
  const translated = entry[locale] || entry.en;
  if (!translated) return raw;
  return raw.replace(trimmed, translated);
}

export function t(key, vars = null, locale = (typeof window !== "undefined" && window.AgentControlI18n?.getLocale()) || currentLocale) {
  let out = translateText(key, locale);
  if (vars && typeof vars === "object") {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

const EXCLUDED_CONTAINER_SELECTOR = [
  "code",
  "pre",
  "script",
  "style",
  "textarea",
  ".message-markdown",
  ".turn-user-text",
  ".tool-output",
  ".diff-view",
  ".active-cwd",
  ".topbar-more-cwd",
].join(",");

const originalTextMap = new WeakMap();
const originalAttrMap = new WeakMap();

function isExcludedElement(el) {
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest(EXCLUDED_CONTAINER_SELECTOR));
}

function translateElementAttributes(el, locale) {
  if (!el || el.nodeType !== 1 || isExcludedElement(el)) return;
  let saved = originalAttrMap.get(el);
  if (!saved) {
    saved = {};
    originalAttrMap.set(el, saved);
  }
  for (const attr of ["title", "placeholder", "aria-label"]) {
    if (!el.hasAttribute(attr)) continue;
    const cur = el.getAttribute(attr);
    if (!(attr in saved)) {
      saved[attr] = cur;
    } else if (cur !== translateText(saved[attr], currentLocale) && cur !== saved[attr]) {
      // Dynamic JS updated the attribute; treat the new value as the latest source.
      saved[attr] = cur;
    }
    const next = translateText(saved[attr], locale);
    if (next !== cur) {
      el.setAttribute(attr, next);
    }
  }
}

function translateTextNode(node, locale) {
  if (!node || node.nodeType !== 3) return;
  const parent = node.parentElement;
  if (!parent || isExcludedElement(parent)) return;
  const cur = node.nodeValue;
  if (!cur || !cur.trim()) return;

  let src = originalTextMap.get(node);
  if (src === undefined) {
    src = cur;
    originalTextMap.set(node, src);
  } else if (cur !== translateText(src, currentLocale) && cur !== src) {
    src = cur;
    originalTextMap.set(node, src);
  }
  const next = translateText(src, locale);
  if (next !== cur) {
    node.nodeValue = next;
  }
}

export function applyDomTranslations(root = typeof document !== "undefined" ? document : null, locale = currentLocale) {
  if (!root) return;
  if (root.documentElement) {
    root.documentElement.lang = locale;
  }
  if (root.title) {
    if (!root.__acOriginalTitle) root.__acOriginalTitle = root.title;
    root.title = translateText(root.__acOriginalTitle, locale);
  }
  const container = root.body || root;
  if (!container || typeof root.createTreeWalker !== "function") return;
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  if (!doc) return;

  const elWalker = doc.createTreeWalker(container, 1 /* SHOW_ELEMENT */);
  let curEl = container;
  while (curEl) {
    translateElementAttributes(curEl, locale);
    curEl = elWalker.nextNode();
  }

  const textWalker = doc.createTreeWalker(container, 4 /* SHOW_TEXT */);
  let curText = textWalker.nextNode();
  while (curText) {
    translateTextNode(curText, locale);
    curText = textWalker.nextNode();
  }
}

export function setLocale(nextLocale, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const normalized = normalizeLocale(nextLocale) || "en";
  currentLocale = normalized;
  try {
    storage?.setItem?.(LOCALE_STORAGE_KEY, normalized);
  } catch {}
  if (typeof document !== "undefined") {
    applyDomTranslations(document, normalized);
    const selectEl = document.getElementById("localeSelect");
    if (selectEl && selectEl.value !== normalized) {
      selectEl.value = normalized;
    }
  }
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("ac:locale-change", { detail: { locale: normalized } }));
  }
  return normalized;
}

export function installAutoDomTranslator(root = typeof document !== "undefined" ? document : null) {
  if (!root) return null;
  applyDomTranslations(root, currentLocale);

  const selectEl = root.getElementById?.("localeSelect");
  if (selectEl) {
    selectEl.value = currentLocale;
    selectEl.addEventListener("change", (ev) => {
      setLocale(ev.target.value);
    });
  }

  if (typeof MutationObserver === "undefined") return null;
  const target = root.body || root;
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled || currentLocale === "zh-CN") return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyDomTranslations(root, currentLocale);
    });
  });
  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["title", "placeholder", "aria-label"],
  });
  return observer;
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.AgentControlI18n) {
  window.AgentControlI18n = {
    getLocale,
    setLocale,
    t,
    translateText,
    applyDomTranslations,
    SUPPORTED_LOCALES,
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => installAutoDomTranslator(document), { once: true });
  } else {
    installAutoDomTranslator(document);
  }
}
