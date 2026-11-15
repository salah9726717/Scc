const pages = ["home", "tasks", "invite", "withdrawals"];

// ---------- Backend: Frontend -> API -> DB (auth = Telegram initData) ----------
const tgApp = window.Telegram?.WebApp;
// The mini app is hosted on Vercel while the API runs on Render.
// Keep API requests pointed at the backend instead of the frontend origin.
const API_BASE_URL = "https://scc-09h0.onrender.com/api";
const STATE = {
  user: null, balance: 0, tasks: [], taskStates: {},
  daily: { days: [], collectedToday: false },
  referrals: { invited: 0, successful: 0 },
  config: { taskReward: 1.5, dailyReward: 1, referralReward: 2, minWithdraw: 200, withdrawFee: 7, requiredReferrals: 10, verifySeconds: 10 }
};
let TASK_LINKS = [];
let TASK_REWARD = 1.5, DAILY_REWARD = 1, MIN_WITHDRAW = 200, WITHDRAW_FEE = 7, REQUIRED_REFERRALS = 10, VERIFY_SECONDS = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function openLink(url) {
  if (tgApp?.openTelegramLink) tgApp.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}
async function api(path, options = {}, retries = 0) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: options.body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Authorization: `tma ${tgApp?.initData || ""}` },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const err = new Error(data.error || "Please try again."); err.status = res.status; throw err; }
      return data;
    } catch (e) {
      if (!e.status) e.message = "Connection problem. Check your internet and try again.";
      lastError = e;
      if ((e.status && e.status < 500) || attempt === retries) break;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastError;
}
function applyState(data) {
  STATE.user = data.user; STATE.balance = Number(data.balance) || 0;
  STATE.tasks = data.tasks || []; STATE.taskStates = data.taskStates || {};
  STATE.daily = data.daily || { days: [], collectedToday: false };
  STATE.referrals = data.referrals || { invited: 0, successful: 0 };
  STATE.config = { ...STATE.config, ...(data.config || {}) };
  TASK_LINKS = STATE.tasks.map((t) => t.url);
  TASK_REWARD = STATE.config.taskReward; DAILY_REWARD = STATE.config.dailyReward; MIN_WITHDRAW = STATE.config.minWithdraw;
  WITHDRAW_FEE = STATE.config.withdrawFee; REQUIRED_REFERRALS = STATE.config.requiredReferrals; VERIFY_SECONDS = STATE.config.verifySeconds;
  updateSummary();
}
async function refreshState() { try { applyState(await api("/me")); return true; } catch (e) { return false; } }

function getSuccessfulReferrals() { return Math.max(0, Math.floor(Number(STATE.referrals.successful)) || 0); }
function getBalance() { return STATE.balance; }
function claimedTaskCount() { return TASK_LINKS.filter((_, i) => STATE.taskStates[i] === "claimed").length; }
function formatMoney(value) {
  const rounded = Math.round(value * 100) / 100;
  return `$${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}
function getWithdrawRules() {
  const referrals = getSuccessfulReferrals();
  const done = claimedTaskCount();
  const balance = getBalance();
  return [
    { text: `${REQUIRED_REFERRALS} successful referrals`, progress: `${Math.min(referrals, REQUIRED_REFERRALS)}/${REQUIRED_REFERRALS}`, met: referrals >= REQUIRED_REFERRALS },
    { text: "Tasks done", progress: `${done}/${TASK_LINKS.length}`, met: TASK_LINKS.length > 0 && done >= TASK_LINKS.length },
    { text: `Min withdraw reached $${MIN_WITHDRAW}`, progress: `${formatMoney(balance)}/$${MIN_WITHDRAW}`, met: balance >= MIN_WITHDRAW }
  ];
}
// Home cards: ACTIVE BALANCE and ACTIVE TASKS (total/claimed)
function updateSummary() {
  const balanceNode = document.getElementById("user-balance");
  const tasksNode = document.getElementById("user-tasks");
  if (balanceNode) balanceNode.textContent = formatMoney(getBalance());
  if (tasksNode) tasksNode.textContent = `${TASK_LINKS.length}/${claimedTaskCount()}`;
}

const navItems = document.querySelectorAll(".nav-item");

function openPage(page) {
  if (!pages.includes(page)) return;
  document.body.classList.toggle("is-home", page === "home");

  navItems.forEach((item) => {
    const selected = item.dataset.page === page;
    item.classList.toggle("active", selected);

    if (selected) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  const pageArea = document.querySelector(".page-area");
  pageArea.dataset.currentPage = page;

  if (page === "home") {
    pageArea.innerHTML = `
      <section class="user-card" aria-label="User account information">
        <div class="user-card-top">
          <div class="user-avatar" id="user-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"></circle><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"></path></svg>
          </div>
          <div class="user-main">
            <h2 id="user-name">Profile</h2>
            <p id="user-username">@username</p>
            <p class="telegram-id">Telegram ID: <strong id="user-id">—</strong></p>
          </div>
          <span class="account-status"><span></span> Active</span>
        </div>
      </section>
      <section class="account-summary-cards" aria-label="Account summary">
        <article class="summary-card"><span class="summary-label">ACTIVE BALANCE</span><strong class="summary-value" id="user-balance">$0</strong></article>
        <article class="summary-card"><span class="summary-label">ACTIVE TASKS</span><strong class="summary-value" id="user-tasks">0/0</strong></article>
      </section>
      <button type="button" class="withdraw-btn" id="home-withdraw-btn" data-go-page="withdrawals">
        <span>Withdraw</span>
      </button>
      <button type="button" class="invite-promo" id="home-invite-card">
        <span class="invite-promo-label">INVITE &amp; SHARE</span>
        <strong class="invite-promo-title">Invite friends, earn together</strong>
        <span class="invite-promo-desc">Share your personal invite link with friends and earn a reward when your invited friend becomes successful.</span>
      </button>
      <section class="more-info" aria-label="More info">
        <h2 class="more-info-title">More Info</h2>
        <div class="more-info-body">
          <span class="more-info-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M21.5 3.6 2.9 10.8c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.5c.2.6 1 .8 1.4.3l2.6-2.5 4.7 3.5c.6.4 1.4.1 1.6-.6l3.1-15.1c.2-.9-.7-1.6-1.2-1.1ZM9.2 13.6l8.4-5.2-6.5 6.2-.3 3.2-1.6-4.2Z"/></svg>
          </span>
          <p class="more-info-desc">Join our official Telegram channel to get the latest news, updates and announcements from Sophia Company.</p>
          <button type="button" class="more-info-open" id="home-news-btn">Open</button>
        </div>
      </section>`;
    populateUserCard();
    bindHomeWithdrawButton();
  } else if (page === "tasks") {
    renderTasksPage();
  } else if (page === "invite") {
    renderInvitePage();
    refreshState().then((ok) => { if (ok && pageArea.dataset.currentPage === "invite") renderInvitePage(); });
  } else if (page === "withdrawals") {
    renderWithdrawPage();
    refreshState().then((ok) => {
      const addr = document.getElementById("wd-address"), amt = document.getElementById("wd-amount");
      if (ok && pageArea.dataset.currentPage === "withdrawals" && addr && amt && !addr.value && !amt.value) renderWithdrawPage();
    });
  } else {
    pageArea.innerHTML = "";
  }
}

function bindHomeWithdrawButton() {
  const btn = document.getElementById("home-withdraw-btn");
  if (btn) btn.addEventListener("click", () => openPage("withdrawals"));
  const inviteCard = document.getElementById("home-invite-card");
  if (inviteCard) inviteCard.addEventListener("click", () => openPage("invite"));
  const newsBtn = document.getElementById("home-news-btn");
  if (newsBtn) newsBtn.addEventListener("click", () => {
    const url = "https://t.me/Sophiacompanynews";
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  });
}
bindHomeWithdrawButton();

navItems.forEach((item) => {
  item.addEventListener("click", () => openPage(item.dataset.page));
});

// Telegram Mini App setup (also works in a normal browser).
if (window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
}


// Populate the account card from Telegram Mini App data when available.
// No sample account details are inserted when Telegram data is unavailable.
function populateUserCard() {
  updateSummary();
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!tgUser) return;

  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ").trim();
  const nameNode = document.getElementById("user-name");
  const usernameNode = document.getElementById("user-username");
  const idNode = document.getElementById("user-id");
  const avatarNode = document.getElementById("user-avatar");

  if (name) nameNode.textContent = name;
  usernameNode.textContent = tgUser.username ? `@${tgUser.username}` : "Username not set";
  if (tgUser.id !== undefined && tgUser.id !== null) idNode.textContent = String(tgUser.id);

  if (tgUser.photo_url) {
    const avatar = document.createElement("img");
    avatar.src = tgUser.photo_url;
    avatar.alt = "";
    avatarNode.replaceChildren(avatar);
  }
}
populateUserCard();


function getInviteLink() {
  const userId = tgApp?.initDataUnsafe?.user?.id || STATE.user?.id;
  if (!userId) return "";
  return `https://t.me/Sophiacompanybot?start=${encodeURIComponent(userId)}`;
}

function renderInvitePage() {
  const pageArea = document.querySelector(".page-area");
  const inviteLink = getInviteLink();
  const shownLink = inviteLink || "Open inside Telegram to generate your link";
  pageArea.innerHTML = `
    <div class="invite-page">
      <section class="invite-hero">
        <span class="invite-kicker">
          <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M16 11h6"/></svg>
          SOPHIA COMPANY REFERRALS
        </span>
        <h1>Invite friends.<br>Earn together.</h1>
        <p>Share your personal invite link and earn a reward when your invited friend becomes successful.</p>
      </section>

      <section class="invite-link-card">
        <span class="invite-section-label">YOUR PERSONAL INVITE LINK</span>
        <div class="invite-link-row">
          <span class="invite-link-text" id="invite-link-value">${escapeHtml(shownLink)}</span>
          <button class="invite-copy" id="invite-copy-btn" type="button" aria-label="Copy invite link" ${inviteLink ? "" : "disabled"}>
            <svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>
          </button>
        </div>
        <button class="invite-share" id="invite-share-btn" type="button" ${inviteLink ? "" : "disabled"}>
          <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.6 6.6-4.2M8.7 13.4l6.6 4.2"/></svg>
          Share Invite Link
        </button>
      </section>

      <section class="invite-stats" aria-label="Invite statistics">
        <article class="invite-stat">
          <span class="invite-stat-icon"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.2a4.5 4.5 0 0 1 4.5-4.5h2a4.5 4.5 0 0 1 4.5 4.5V20M17 8v6M14 11h6"/></svg></span>
          <strong id="invite-count">${STATE.referrals.invited}</strong><span>INVITED</span>
        </article>
        <article class="invite-stat">
          <span class="invite-stat-icon"><svg viewBox="0 0 24 24"><path d="m5 12 4.2 4.2L19.5 6"/></svg></span>
          <strong id="invite-success-count">${getSuccessfulReferrals()}</strong><span>SUCCESSFUL</span>
        </article>
        <article class="invite-stat">
          <span class="invite-stat-icon"><svg viewBox="0 0 24 24"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>
          <strong id="invite-earned">${formatMoney(getSuccessfulReferrals() * STATE.config.referralReward)}</strong><span>EARNED</span>
        </article>
      </section>

      <section class="invite-how">
        <h2>How it works</h2>
        <div class="how-step">
          <span class="how-number">01</span>
          <div class="how-copy"><strong>Invite a friend</strong><p>Share your personal link. A user is counted as invited when they open the link and start the Sophia Company app.</p></div>
        </div>
        <div class="how-step">
          <span class="how-number">02</span>
          <div class="how-copy"><strong>They complete all tasks</strong><p>Your invited user becomes successful after completing all tasks.</p></div>
        </div>
        <div class="how-step">
          <span class="how-number">03</span>
          <div class="how-copy"><strong>You earn $2</strong><p>Receive $2 for each successful referral after all their tasks are verified as completed.</p></div>
        </div>
        <div class="invite-reward-note">Only genuine app starts and verified completed tasks count. Your totals update automatically.</div>
      </section>
    </div>`;

  const copyBtn = document.getElementById("invite-copy-btn");
  const shareBtn = document.getElementById("invite-share-btn");
  if (copyBtn && inviteLink) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(inviteLink);
        showInviteToast("Invite link copied");
      } catch {
        showInviteToast("Could not copy link");
      }
    });
  }
  if (shareBtn && inviteLink) {
    shareBtn.addEventListener("click", () => {
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent("Join me on Sophia Company!")}`;
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, "_blank", "noopener");
      }
    });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showInviteToast(message) {
  document.querySelector(".invite-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "invite-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 1800);
}



function renderTasksPage() {
  const pageArea = document.querySelector(".page-area");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const collectedDays = new Set(STATE.daily.days);
  pageArea.innerHTML = `
    <div class="tasks-page">
      <section class="daily-reward-card" aria-label="Daily rewards">
        <div class="daily-reward-top">
          <div class="daily-reward-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 2.8v2.1M12 19.1v2.1M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"/><circle cx="12" cy="12" r="4.2"/></svg>
          </div>
          <div class="daily-reward-heading"><h1>Daily Rewards</h1><p>Collect your reward every day</p></div>
          <div class="daily-reward-amount"><strong>$1</strong><span>REWARD</span></div>
        </div>
        <div class="daily-days" aria-label="Days of the week">
          ${days.map((day) => {
            const collected = collectedDays.has(day);
            return `<div class="daily-day${collected ? " is-collected" : ""}" aria-label="${day}${collected ? ", reward collected" : ", not collected"}">
              <span class="daily-day-mark"><span class="daily-day-name">${day}</span>${collected ? '<span class="daily-day-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 6.8"/></svg></span>' : ""}</span>
            </div>`;
          }).join("")}
        </div>
        <button class="collect-today-btn" id="collect-today-btn" type="button">
          <span>Collect Today</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5"/></svg>
        </button>
      </section>

      <section class="task-list" aria-label="Tasks">
        <div class="task-list-head">
          <h2 class="task-list-title">Tasks</h2>
          <span class="task-reward-tag">Per task reward $${TASK_REWARD}</span>
        </div>
        ${TASK_LINKS.map((url, i) => `
          <article class="task-row" data-task="${i}">
            <span class="task-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M21.5 3.6 2.9 10.8c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.5c.2.6 1 .8 1.4.3l2.6-2.5 4.7 3.5c.6.4 1.4.1 1.6-.6l3.1-15.1c.2-.9-.7-1.6-1.2-1.1ZM9.2 13.6l8.4-5.2-6.5 6.2-.3 3.2-1.6-4.2Z"/></svg>
            </span>
            <div class="task-info"><strong>Task ${i + 1}</strong><span>Join Telegram channel</span></div>
            <button class="task-btn" type="button"></button>
          </article>`).join("")}
      </section>
    </div>`;

  initTaskList();

  document.getElementById("collect-today-btn")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    if (STATE.daily.collectedToday) return showTasksNotice("You already collected today's reward.");
    btn.disabled = true;
    try {
      const r = await api("/daily/collect", { body: {} });
      STATE.balance = r.balance; STATE.daily = r.daily;
      updateSummary();
      showTasksNotice(`${formatMoney(DAILY_REWARD)} added to your balance.`);
      renderTasksPage();
    } catch (e) { btn.disabled = false; showTasksNotice(e.message); }
  });
}

function showTasksNotice(message) {
  document.querySelector(".tasks-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "tasks-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

// ---------- Withdraw page ----------
// Balance, rules and requests all come from the API (see server.js).
function renderWithdrawPage() {
  const pageArea = document.querySelector(".page-area");

  pageArea.innerHTML = `
    <div class="withdraw-page">
      <section class="wd-header">
        <h1>Withdraw</h1>
        <p>Send your earnings to your USDT (BEP20) wallet.</p>
      </section>

      <section class="wd-card" aria-label="Withdraw rules">
        <h2 class="wd-history-title">Withdraw Rules</h2>
        <ul class="wd-rules">
          ${getWithdrawRules().map((rule, i) => `
            <li class="wd-rule${rule.met ? " is-met" : ""}">
              <span class="wd-rule-num">${rule.met ? "&#10003;" : i + 1}</span>
              <span class="wd-rule-text">${escapeHtml(rule.text)}</span>
              <span class="wd-rule-progress">${escapeHtml(rule.progress)}</span>
            </li>`).join("")}
        </ul>
      </section>

      <section class="wd-card" aria-label="Withdraw form">
        <label class="wd-label" for="wd-address">USDT BEP20 ADDRESS</label>
        <div class="wd-input-row">
          <input class="wd-input" id="wd-address" type="text" placeholder="0x..." autocomplete="off" autocapitalize="off" spellcheck="false" />
          <button class="wd-mini-btn" id="wd-paste" type="button">PASTE</button>
        </div>

        <label class="wd-label" for="wd-amount">AMOUNT</label>
        <div class="wd-input-row">
          <input class="wd-input" id="wd-amount" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" />
          <button class="wd-mini-btn" id="wd-max" type="button">MAX</button>
        </div>
        <div class="wd-fee" id="wd-fee"></div>

        <button class="wd-confirm" id="wd-confirm" type="button">CONFIRM</button>
      </section>
    </div>`;

  const addressInput = document.getElementById("wd-address");
  const amountInput = document.getElementById("wd-amount");

  const feeNode = document.getElementById("wd-fee");
  const updateFee = () => {
    const value = Number(amountInput.value.replace(",", "."));
    const net = Number.isFinite(value) && value > WITHDRAW_FEE ? value - WITHDRAW_FEE : 0;
    feeNode.innerHTML = `<span>Fee: <strong>${formatMoney(WITHDRAW_FEE)}</strong></span><span>You receive: <strong>${formatMoney(net)}</strong></span>`;
  };
  amountInput.addEventListener("input", updateFee);
  updateFee();

  document.getElementById("wd-paste").addEventListener("click", async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) addressInput.value = text;
      else showInviteToast("Clipboard is empty");
    } catch (error) {
      showInviteToast("Cannot read clipboard — paste manually");
      addressInput.focus();
    }
  });

  document.getElementById("wd-max").addEventListener("click", () => {
    const balance = getBalance();
    if (balance > 0) { amountInput.value = String(balance); updateFee(); }
    else showInviteToast("No available balance");
  });

  const confirmBtn = document.getElementById("wd-confirm");
  confirmBtn.addEventListener("click", async () => {
    const address = addressInput.value.trim();
    const amount = Number(amountInput.value.replace(",", "."));
    if (!getWithdrawRules().every((rule) => rule.met)) return showInviteToast("Complete all withdraw rules first");
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return showInviteToast("Enter a valid BEP20 address");
    if (!Number.isFinite(amount) || amount <= 0) return showInviteToast("Enter a valid amount");
    if (amount < MIN_WITHDRAW) return showInviteToast(`Minimum withdraw is $${MIN_WITHDRAW}`);
    if (amount > getBalance()) return showInviteToast("Amount is higher than your balance");
    confirmBtn.disabled = true;
    try {
      const r = await api("/withdraw", { body: { address, amount } });
      STATE.balance = r.balance;
      updateSummary();
      renderWithdrawPage();
      showWithdrawSuccess(amount, amount - WITHDRAW_FEE);
    } catch (e) {
      confirmBtn.disabled = false;
      showInviteToast(e.message);
    }
  });
}


function showWithdrawSuccess(amount, net) {
  document.querySelector(".wd-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "wd-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="wd-modal-card">
      <div class="wd-modal-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.5 12.5 4.2 4.2 8.8-9.4"/></svg></div>
      <h3>Withdrawal Submitted</h3>
      <p>You withdrew <strong>${formatMoney(amount)}</strong>.<br>You will receive <strong>${formatMoney(net)}</strong> after the ${formatMoney(WITHDRAW_FEE)} fee.</p>
      <span class="wd-modal-status">Status: Pending</span>
      <button type="button" class="wd-modal-btn">OK</button>
    </div>`;
  const close = () => modal.remove();
  modal.querySelector(".wd-modal-btn").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
}


// ---------- Telegram channel tasks (server verifies membership after 10 sec) ----------
function initTaskList() {
  const rows = document.querySelectorAll(".task-row");

  const paint = (row, status, seconds) => {
    const btn = row.querySelector(".task-btn");
    btn.className = "task-btn";
    btn.disabled = false;
    if (status === "verifying") { btn.textContent = `Verifying ${seconds}s`; btn.disabled = true; btn.classList.add("is-verifying"); }
    else if (status === "ready") { btn.textContent = "Claim"; btn.classList.add("is-claim"); }
    else if (status === "claimed") { btn.textContent = "Claimed"; btn.disabled = true; btn.classList.add("is-claimed"); }
    else { btn.textContent = "Go"; }
  };

  rows.forEach((row) => {
    const id = Number(row.dataset.task);
    const url = TASK_LINKS[id];
    const btn = row.querySelector(".task-btn");
    paint(row, STATE.taskStates[id] || "go");

    btn.addEventListener("click", async () => {
      const current = STATE.taskStates[id] || "go";
      if (btn.disabled) return;

      if (current === "go") {
        paint(row, "verifying", VERIFY_SECONDS);
        try { await api(`/tasks/${id}/start`, { body: {} }, 1); }
        catch (e) { paint(row, "go"); return showTasksNotice(e.message); }
        openLink(url);
        for (let s = VERIFY_SECONDS; s > 0; s--) { paint(row, "verifying", s); await sleep(1000); }
        try {
          await api(`/tasks/${id}/verify`, { body: {} }, 1);
          STATE.taskStates[id] = "ready";
          paint(row, "ready");
        } catch (e) { paint(row, "go"); showTasksNotice(e.message); }
        return;
      }

      if (current === "ready") {
        btn.disabled = true;
        try {
          const r = await api(`/tasks/${id}/claim`, { body: {} }, 1);
          STATE.taskStates[id] = "claimed";
          STATE.balance = r.balance;
          paint(row, "claimed");
          updateSummary();
          showTasksNotice(`${formatMoney(TASK_REWARD)} added to your balance.`);
        } catch (e) {
          if (e.status === 409) { STATE.taskStates[id] = "claimed"; paint(row, "claimed"); }
          else { paint(row, "ready"); showTasksNotice(e.message); }
        }
      }
    });
  });
}

// ---------- Boot: load everything from the API before showing the app ----------
function showBoot(title, text, buttonLabel, onClick) {
  document.getElementById("boot")?.remove();
  const box = document.createElement("div");
  box.id = "boot";
  box.className = "boot";
  box.innerHTML = `<div class="boot-card">${buttonLabel ? "" : '<div class="boot-spinner"></div>'}<h3>${escapeHtml(title)}</h3>${text ? `<p>${escapeHtml(text)}</p>` : ""}${buttonLabel ? '<button type="button" class="boot-btn"></button>' : ""}</div>`;
  if (buttonLabel) {
    const b = box.querySelector(".boot-btn");
    b.textContent = buttonLabel;
    b.addEventListener("click", onClick);
  }
  document.body.appendChild(box);
}
async function boot() {
  if (!tgApp?.initData) {
    return showBoot("Open inside Telegram", "This app works only inside Telegram.", "Open @Sophiacompanybot", () => window.open("https://t.me/Sophiacompanybot", "_blank", "noopener"));
  }
  showBoot("Loading...", "");
  try {
    applyState(await api("/me", {}, 3));
    document.getElementById("boot")?.remove();
    populateUserCard();
  } catch (e) {
    showBoot("Connection problem", e.message, "Retry", boot);
  }
}
boot();
