// Global State
let accounts = {};
let transactions = [];
let cycleStartMonth = '2026-11';

document.addEventListener('DOMContentLoaded', () => {
  const cycleStartInput = document.getElementById('cycle-start');
  if (cycleStartInput) cycleStartInput.value = cycleStartMonth;

  const savedMonth = localStorage.getItem('fs_active_month');
  const activeMonthInput = document.getElementById('active-month');
  if (activeMonthInput) {
    if (savedMonth) {
      activeMonthInput.value = savedMonth;
    } else {
      activeMonthInput.value = cycleStartMonth;
      localStorage.setItem('fs_active_month', cycleStartMonth);
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('tx-date');
  if (dateInput) dateInput.value = todayStr;

  checkSabbath();
  updateCyclePeriod();
  loadData();
});

// Sync Status Indicator
function updateSyncBadge(connected, text) {
  const badge = document.getElementById('sync-status');
  const textSpan = document.getElementById('sync-text');
  if (!badge || !textSpan) return;

  textSpan.innerText = text;
  if (connected) {
    badge.className = "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  } else {
    badge.className = "flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20";
  }
}

// Data Fetching & Syncing
async function loadData() {
  try {
    const res = await fetch('/api/items');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Parse database items if available
        transactions = data.map(item => typeof item.text === 'string' ? JSON.parse(item.text) : item);
      } else {
        loadLocalData();
        return;
      }
      recomputeAccountSharesFromTransactions();
      refreshAllViews();
      updateSyncBadge(true, "Database Synced");
    } else {
      loadLocalData();
    }
  } catch (err) {
    console.warn("Failed to fetch from API, using localStorage:", err);
    loadLocalData();
  }
}

function loadLocalData() {
  try {
    accounts = JSON.parse(localStorage.getItem('fs_accounts')) || {};
    transactions = JSON.parse(localStorage.getItem('fs_transactions')) || [];
  } catch (e) {
    accounts = {};
    transactions = [];
  }
  recomputeAccountSharesFromTransactions();
  refreshAllViews();
  updateSyncBadge(false, "Local Mode");
}

async function saveData() {
  localStorage.setItem('fs_accounts', JSON.stringify(accounts));
  localStorage.setItem('fs_transactions', JSON.stringify(transactions));

  try {
    await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: JSON.stringify(transactions) })
    });
    updateSyncBadge(true, "Database Synced");
  } catch (err) {
    console.warn("API save failed, saved locally:", err);
    updateSyncBadge(false, "Local Storage Only");
  }
}

// Active Month & Periods
function onActiveMonthChange() {
  const activeMonthInput = document.getElementById('active-month');
  if (!activeMonthInput) return;
  localStorage.setItem('fs_active_month', activeMonthInput.value);
  refreshAllViews();
}

function updateCyclePeriod() {
  const cycleStartInput = document.getElementById('cycle-start');
  if (!cycleStartInput) return;
  cycleStartMonth = cycleStartInput.value;
  if (cycleStartMonth) {
    const [year, month] = cycleStartMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month - 1 + 11, 1);

    const startStr = startDate.toLocaleString('default', { month: 'short', year: 'numeric' });
    const endStr = endDate.toLocaleString('default', { month: 'short', year: 'numeric' });

    const span = document.getElementById('cycle-display-span');
    if (span) span.innerText = `${startStr} – ${endStr} (12 Mo)`;
  }
  refreshAllViews();
}

// Navigation & Toasts
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-indigo-600', 'text-white');
    btn.classList.add('text-slate-400', 'hover:bg-slate-900');
  });

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove('hidden');

  const activeBtn = document.getElementById('btn-' + tabId);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400', 'hover:bg-slate-900');
    activeBtn.classList.add('bg-indigo-600', 'text-white');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `px-4 py-3 rounded-xl text-xs font-semibold shadow-xl border transition-all duration-300 transform translate-y-2 opacity-0 flex items-center gap-2 ${
    type === 'error' ? 'bg-rose-950/90 text-rose-200 border-rose-800' : 'bg-indigo-950/90 text-indigo-200 border-indigo-800'
  }`;
  toast.innerHTML = message;
  container.appendChild(toast);

  setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function checkSabbath() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  let isSabbath = (day === 5 && hour >= 18) || (day === 6 && hour < 18);

  if (isSabbath) {
    const banner = document.getElementById('sabbath-banner');
    if (banner) banner.classList.remove('hidden');
    const submitBtn = document.getElementById('tx-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.replace('bg-indigo-600', 'bg-slate-700');
      submitBtn.innerText = 'Disabled During Sabbath';
    }
  }
}

// Data Helpers & Share Calculations
function getSortedAccounts() {
  if (!accounts || typeof accounts !== 'object') return [];
  return Object.values(accounts).sort((a, b) => {
    const nameCompare = (a.name || '').localeCompare(b.name || '');
    if (nameCompare !== 0) return nameCompare;
    return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
  });
}

function getUniqueMemberNames() {
  const namesSet = new Set();
  Object.values(accounts).forEach(acc => {
    if (acc && acc.name) namesSet.add(acc.name.trim());
  });
  return Array.from(namesSet).sort();
}

function getBillingWindow(activeMonthStr) {
  if (!activeMonthStr) activeMonthStr = '2026-11';
  const [y, m] = activeMonthStr.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 25);
  const activeDate = new Date(y, m - 1, 5);

  const startStr = prevDate.toISOString().split('T')[0];
  const endStr = activeDate.toISOString().split('T')[0];
  return { startStr, endStr };
}

function isDateInBillingWindow(dateStr, activeMonthStr) {
  if (!dateStr || !activeMonthStr) return false;
  const { startStr, endStr } = getBillingWindow(activeMonthStr);
  return dateStr >= startStr && dateStr <= endStr;
}

function recomputeAccountSharesFromTransactions() {
  Object.values(accounts).forEach(acc => { acc.shares = 0; });
  transactions.forEach(tx => {
    if (tx.type === 'Share Contribution' && tx.memberName) {
      const memberAccs = Object.values(accounts).filter(a => a.name && a.name.trim().toLowerCase() === tx.memberName.trim().toLowerCase());
      if (memberAccs.length > 0) {
        const sharePerAcc = tx.amount / memberAccs.length;
        memberAccs.forEach(acc => { acc.shares = (acc.shares || 0) + sharePerAcc; });
      }
    }
  });
}

// Account Registration
const memberForm = document.getElementById('member-form');
if (memberForm) {
  memberForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('member-name');
    const countInput = document.getElementById('member-acc-count');

    if (!nameInput || !countInput) return;
    const fullName = nameInput.value.trim();
    const count = parseInt(countInput.value) || 1;

    const firstName = fullName.split(' ')[0].replace(/[^a-zA-Z]/g, '');
    const existingMemberAccounts = Object.values(accounts).filter(a => a.name && a.name.toLowerCase() === fullName.toLowerCase());

    if (existingMemberAccounts.length + count > 5) {
      alert(`Cannot add ${count} account(s). Maximum of 5 accounts per member limit reached.`);
      return;
    }

    const createdIds = [];
    for (let i = 0; i < count; i++) {
      const seqNum = existingMemberAccounts.length + i + 1;
      const accId = `${firstName}-${seqNum}`;

      accounts[accId] = {
        id: accId,
        name: fullName,
        shares: 0,
        monthlyShareDue: 2000,
        loanBalance: 0,
        loanTermMonths: 4,
        loanRate: 0.03,
        dividends: 0
      };
      createdIds.push(accId);
    }

    recomputeAccountSharesFromTransactions();
    saveData();
    showToast(`Created ${count} account(s): ${createdIds.join(', ')}`);
    memberForm.reset();
    countInput.value = 1;
    refreshAllViews();
  });
}

function editMemberInfo(accId) {
  const acc = accounts[accId];
  if (!acc) return;

  const newName = prompt(`Update Name for Account ${accId}:`, acc.name);
  if (newName === null) return;

  if (newName.trim() !== '') acc.name = newName.trim();
  saveData();
  refreshAllViews();
  showToast(`Account ${accId} updated.`);
}

// Transaction Logging
function toggleTxFields() {
  const typeEl = document.getElementById('tx-type');
  if (!typeEl) return;
  const type = typeEl.value;
  const containerMember = document.getElementById('container-member-select');
  const containerAccount = document.getElementById('container-account-select');
  const loanTermContainer = document.getElementById('loan-term-container');
  const guarantorContainer = document.getElementById('guarantor-container');

  if (type === 'Share Contribution') {
    if (containerMember) containerMember.classList.remove('hidden');
    if (containerAccount) containerAccount.classList.add('hidden');
    autoCalculateShareAmount();
  } else {
    if (containerMember) containerMember.classList.add('hidden');
    if (containerAccount) containerAccount.classList.remove('hidden');
  }

  if (type === 'Member Loan' || type === 'Non-Member Loan') {
    if (loanTermContainer) loanTermContainer.classList.remove('hidden');
  } else {
    if (loanTermContainer) loanTermContainer.classList.add('hidden');
  }

  if (type === 'Non-Member Loan') {
    if (guarantorContainer) guarantorContainer.classList.remove('hidden');
  } else {
    if (guarantorContainer) guarantorContainer.classList.add('hidden');
  }
}

function autoCalculateShareAmount() {
  const typeEl = document.getElementById('tx-type');
  if (!typeEl || typeEl.value !== 'Share Contribution') return;

  const memberSelect = document.getElementById('tx-member');
  const amountInput = document.getElementById('tx-amount');
  if (!memberSelect || !amountInput) return;

  const selectedMember = memberSelect.value;
  if (!selectedMember) return;

  const memberAccounts = Object.values(accounts).filter(a => a.name && a.name.trim().toLowerCase() === selectedMember.toLowerCase());
  amountInput.value = memberAccounts.length * 2000;
}

const txForm = document.getElementById('tx-form');
if (txForm) {
  txForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const editIndexInput = document.getElementById('edit-tx-index');
    const typeEl = document.getElementById('tx-type');
    const amountEl = document.getElementById('tx-amount');
    const dateEl = document.getElementById('tx-date');
    const guarantorEl = document.getElementById('tx-guarantor');
    const termEl = document.getElementById('tx-loan-term');

    const editIndex = editIndexInput ? parseInt(editIndexInput.value) : -1;
    const type = typeEl ? typeEl.value : '';
    const amount = amountEl ? parseFloat(amountEl.value) : 0;
    const date = dateEl ? dateEl.value : '';
    const guarantor = guarantorEl ? guarantorEl.value : '';
    const termMonths = termEl ? (parseInt(termEl.value) || 4) : 4;

    if (editIndex >= 0 && transactions[editIndex]) {
      reverseTransactionEffects(transactions[editIndex]);
    }

    let accId = null;
    let memberName = null;

    if (type === 'Share Contribution') {
      const memberSelect = document.getElementById('tx-member');
      memberName = memberSelect ? memberSelect.value : '';
      if (!memberName) {
        alert('Please select a valid member.');
        return;
      }
    } else {
      const accSelect = document.getElementById('tx-account');
      accId = accSelect ? accSelect.value : '';
      if (!accounts[accId]) {
        alert('Please select a valid account.');
        return;
      }
      memberName = accounts[accId].name;
    }

    const newTx = { accId, memberName, type, amount, date, guarantor, termMonths };

    if (editIndex >= 0) {
      transactions[editIndex] = newTx;
      showToast('Transaction updated!');
    } else {
      transactions.push(newTx);
      showToast('Transaction recorded!');
    }

    applyTransactionEffects(newTx);
    recomputeAccountSharesFromTransactions();
    saveData();
    cancelTxEdit();
    refreshAllViews();
  });
}

function applyTransactionEffects(tx) {
  if (tx.accId && accounts[tx.accId]) {
    const acc = accounts[tx.accId];
    if (tx.type === 'Member Loan' || tx.type === 'Non-Member Loan') {
      acc.loanBalance = (acc.loanBalance || 0) + tx.amount;
    } else if (tx.type === 'Loan Repayment') {
      acc.loanBalance = Math.max(0, (acc.loanBalance || 0) - tx.amount);
    }
  }
}

function reverseTransactionEffects(tx) {
  if (tx.accId && accounts[tx.accId]) {
    const acc = accounts[tx.accId];
    if (tx.type === 'Member Loan' || tx.type === 'Non-Member Loan') {
      acc.loanBalance = Math.max(0, (acc.loanBalance || 0) - tx.amount);
    } else if (tx.type === 'Loan Repayment') {
      acc.loanBalance = (acc.loanBalance || 0) + tx.amount;
    }
  }
}

function editTransaction(index) {
  const tx = transactions[index];
  if (!tx) return;

  const editIndexInput = document.getElementById('edit-tx-index');
  if (editIndexInput) editIndexInput.value = index;

  const typeEl = document.getElementById('tx-type');
  if (typeEl) typeEl.value = tx.type;

  const amountEl = document.getElementById('tx-amount');
  if (amountEl) amountEl.value = tx.amount;

  const dateEl = document.getElementById('tx-date');
  if (dateEl) dateEl.value = tx.date;

  toggleTxFields();

  const titleEl = document.getElementById('tx-form-title');
  if (titleEl) titleEl.innerText = `Edit Transaction #${index + 1}`;

  const submitBtn = document.getElementById('tx-submit-btn');
  if (submitBtn) submitBtn.innerText = 'Update Transaction';

  const cancelBtn = document.getElementById('tx-cancel-edit-btn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  switchTab('tab-logs');
}

function deleteTransaction(index) {
  const tx = transactions[index];
  if (!tx) return;

  if (confirm(`Delete ${tx.type} of ฿${tx.amount}?`)) {
    reverseTransactionEffects(tx);
    transactions.splice(index, 1);
    recomputeAccountSharesFromTransactions();
    saveData();
    refreshAllViews();
    showToast('Transaction deleted.');
  }
}

function cancelTxEdit() {
  const editIndexInput = document.getElementById('edit-tx-index');
  if (editIndexInput) editIndexInput.value = "-1";

  const form = document.getElementById('tx-form');
  if (form) form.reset();

  toggleTxFields();

  const titleEl = document.getElementById('tx-form-title');
  if (titleEl) titleEl.innerText = 'Record Transaction';

  const submitBtn = document.getElementById('tx-submit-btn');
  if (submitBtn) submitBtn.innerText = 'Submit Transaction';

  const cancelBtn = document.getElementById('tx-cancel-edit-btn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

// Rendering Dashboards & Tables
function renderDashboard() {
  recomputeAccountSharesFromTransactions();

  let monthlyInflow = 0;
  let monthlyOutflow = 0;
  let totalShares = 0;
  let totalLoans = 0;

  Object.values(accounts).forEach(acc => {
    totalShares += (acc.shares || 0);
    totalLoans += (acc.loanBalance || 0);
  });

  const activeMonthInput = document.getElementById('active-month');
  const activeMonthVal = activeMonthInput ? activeMonthInput.value : '2026-11';
  const { startStr, endStr } = getBillingWindow(activeMonthVal);

  transactions.forEach(tx => {
    if (!activeMonthVal || (tx.date >= startStr && tx.date <= endStr)) {
      if (tx.type === 'Share Contribution' || tx.type === 'Loan Repayment' || tx.type === 'Late Fee') {
        monthlyInflow += tx.amount;
      } else if (tx.type === 'Member Loan' || tx.type === 'Non-Member Loan') {
        monthlyOutflow += tx.amount;
      }
    }
  });

  const safeSetText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
  };

  safeSetText('dash-total-shares', `฿${totalShares.toLocaleString()}`);
  safeSetText('dash-total-loans', `฿${totalLoans.toLocaleString()}`);
  safeSetText('dash-loan-pool', `฿${monthlyInflow.toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  safeSetText('dash-outflow', `฿${monthlyOutflow.toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  safeSetText('dash-net-flow', `฿${(monthlyInflow - monthlyOutflow).toLocaleString(undefined, {minimumFractionDigits: 2})}`);
  safeSetText('dash-acc-count', Object.keys(accounts).length);

  updateBankReconciliation();
}

function updateBankReconciliation() {
  const bankInputEl = document.getElementById('bank-statement-input');
  const bankInput = bankInputEl ? parseFloat(bankInputEl.value) : NaN;
  const endingBalance = window.calculatedEndingBalance || 0;
  const varianceEl = document.getElementById('recon-variance');
  const statusText = document.getElementById('recon-status-text');

  if (!varianceEl || !statusText) return;

  if (isNaN(bankInput)) {
    varianceEl.innerText = '฿0.00';
    varianceEl.className = 'text-lg font-bold text-white mt-1';
    statusText.innerText = 'Enter bank statement balance';
    return;
  }

  const variance = bankInput - endingBalance;
  varianceEl.innerText = `฿${variance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

  if (Math.abs(variance) < 0.01) {
    varianceEl.className = 'text-lg font-bold text-emerald-400 mt-1';
    statusText.innerText = '✔ Balanced perfectly with bank';
  } else {
    varianceEl.className = 'text-lg font-bold text-rose-400 mt-1';
    statusText.innerText = `Variance: ฿${variance.toFixed(2)}`;
  }
}

function renderMemberTable() {
  const tbody = document.getElementById('member-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = getSortedAccounts();
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">No member accounts registered yet.</td></tr>';
    return;
  }

  list.forEach((acc, index) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 transition">
        <td class="p-3 font-semibold text-slate-500">${index + 1}.</td>
        <td class="p-3 font-bold text-white">${acc.id}</td>
        <td class="p-3">${acc.name}</td>
        <td class="p-3 font-semibold text-emerald-400">฿${(acc.shares || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td class="p-3"><span class="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span></td>
        <td class="p-3 text-right">
          <button onclick="editMemberInfo('${acc.id}')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1 rounded-lg transition border border-slate-700">Edit</button>
        </td>
      </tr>
    `;
  });
}

function renderLogsTable() {
  const tbody = document.getElementById('logs-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (transactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-500">No transaction logs available.</td></tr>';
    return;
  }

  transactions.slice().reverse().forEach((tx, revIndex) => {
    const originalIndex = transactions.length - 1 - revIndex;
    const displayLabel = tx.memberName ? `${tx.memberName} (Member Share)` : tx.accId;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 transition">
        <td class="p-3 text-slate-400">${tx.date}</td>
        <td class="p-3 font-bold text-white">${displayLabel}</td>
        <td class="p-3"><span class="px-2 py-0.5 text-xs font-medium bg-slate-800 rounded border border-slate-700">${tx.type}</span></td>
        <td class="p-3 font-semibold text-emerald-400">฿${tx.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td class="p-3 text-slate-400">${tx.guarantor || '-'}</td>
        <td class="p-3 text-right space-x-1">
          <button onclick="editTransaction(${originalIndex})" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-lg transition border border-slate-700">Edit</button>
          <button onclick="deleteTransaction(${originalIndex})" class="bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs px-2 py-1 rounded-lg transition border border-rose-800">Delete</button>
        </td>
      </tr>
    `;
  });
}

function updateFormDropdowns() {
  const memberSelect = document.getElementById('tx-member');
  if (memberSelect) {
    const currentVal = memberSelect.value;
    memberSelect.innerHTML = '<option value="">-- Select Member --</option>';
    getUniqueMemberNames().forEach(name => {
      memberSelect.innerHTML += `<option value="${name}">${name}</option>`;
    });
    if (currentVal) memberSelect.value = currentVal;
  }

  const accSelect = document.getElementById('tx-account');
  if (accSelect) {
    const currentVal = accSelect.value;
    accSelect.innerHTML = '<option value="">-- Select Account --</option>';
    getSortedAccounts().forEach(acc => {
      accSelect.innerHTML += `<option value="${acc.id}">${acc.id} - ${acc.name}</option>`;
    });
    if (currentVal && accounts[currentVal]) accSelect.value = currentVal;
  }
}

function refreshAllViews() {
  updateFormDropdowns();
  toggleTxFields();
  renderDashboard();
  renderMemberTable();
  renderLogsTable();
}
