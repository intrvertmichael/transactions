const CARD_COLORS = [
  "#378ADD",
  "#D85A30",
  "#1D9E75",
  "#7F77DD",
  "#D4537E",
  "#BA7517",
]

let txns = []
let cards = []
let activeCard = "all"
let activeLabel = "all"
let activeMonth = "all"
let pendingImportRows = []
let lastImportedTxnIds = []

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function escH(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function fingerprint(date, merchant, amount, cardId) {
  return [
    date.trim(),
    merchant.trim().toLowerCase(),
    parseFloat(amount).toFixed(2),
    cardId,
  ].join("|")
}

function existingFingerprints() {
  return new Set(
    txns.map(t => fingerprint(t.date, t.merchant, t.amount, t.cardId)),
  )
}

async function load() {
  try {
    const r = await window.storage.get("st_txns_v2")
    if (r && r.value) txns = JSON.parse(r.value)
    const c = await window.storage.get("st_cards_v2")
    if (c && c.value) cards = JSON.parse(c.value)
  } catch (e) {}

  if (!cards.length) cards = CARDS.slice()
  if (!txns.length) txns = TRANSACTIONS.slice()
  render()
}

function save() {
  try {
    window.storage.set("st_txns_v2", JSON.stringify(txns))
    window.storage.set("st_cards_v2", JSON.stringify(cards))
  } catch (e) {}
}

function makeDataJsContent() {
  return `const SEED_CARDS = ${JSON.stringify(cards, null, 2)}\n\nconst SEED_TXNS = ${JSON.stringify(txns, null, 2)}\n`
}

function downloadDataJs(filename = "data.js") {
  const blob = new Blob([makeDataJsContent()], { type: "text/javascript" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function saveData() {
  save()
  downloadDataJs()
  showModal(`<div class="modal">
    <h3>Save complete</h3>
    <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.75rem">All current cards and transactions have been saved to storage and an updated <strong>data.js</strong> file has been downloaded. Replace the local file if you want the source seed to match the imported data.</p>
    <div class="modal-btns"><button class="btn-save" onclick="closeModal()">Close</button></div>
  </div>`)
}

function clearAll() {
  showModal(`<div class="modal">
    <h3>Clear all data</h3>
    <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.75rem">This will remove all cards and all transactions. This action cannot be undone.</p>
    <div class="modal-btns"><button class="btn-cancel" onclick="closeModal()">Cancel</button><button class="btn-save" onclick="confirmClearAll()">Clear all</button></div>
  </div>`)
}

function confirmClearAll() {
  cards = []
  txns = []
  activeCard = "all"
  activeLabel = "all"
  activeMonth = "all"
  save()
  render()
  closeModal()
}

function seedData() {
  txns = TRANSACTIONS.slice()
}

function cardColor(id) {
  const i = cards.findIndex(c => c.id === id)
  return CARD_COLORS[i % CARD_COLORS.length] || "#888"
}

function cardName(id) {
  return (cards.find(c => c.id === id) || { name: "Unknown" }).name
}

function months() {
  const s = new Set(txns.map(t => t.date.slice(0, 7)))
  return Array.from(s).sort().reverse()
}

function filteredTxns() {
  return txns.filter(t => {
    if (activeCard !== "all" && t.cardId !== activeCard) return false
    if (activeLabel === "unlabeled") {
      if (t.label) return false
    } else if (activeLabel !== "all" && t.label !== activeLabel) return false
    if (activeMonth !== "all" && t.date.slice(0, 7) !== activeMonth)
      return false
    return true
  })
}

function render() {
  renderSummary()
  renderTabs()
  renderToolbar()
  renderTable()
}

function renderSummary() {
  const sub = filteredTxns()
  const total = sub.reduce((s, t) => s + t.amount, 0)
  const byL = l =>
    sub.filter(t => t.label === l).reduce((s, t) => s + t.amount, 0)

  document.getElementById("summary").innerHTML = `
    <div class="stat"><div class="stat-label">Total spent</div><div class="stat-val">$${total.toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Necessary</div><div class="stat-val green">$${byL("necessary").toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Useful</div><div class="stat-val amber">$${byL("useful").toFixed(2)}</div></div>
    <div class="stat"><div class="stat-label">Impulsive</div><div class="stat-val red">$${byL("impulsive").toFixed(2)}</div></div>`
}

function renderTabs() {
  const all = txns.reduce((s, t) => s + t.amount, 0)
  let html = `<button class="tab${activeCard === "all" ? " active" : ""}" onclick="setCard('all')">All cards <span style="color:var(--color-text-secondary);font-weight:400">$${all.toFixed(2)}</span></button>`

  cards.forEach(c => {
    const tot = txns
      .filter(t => t.cardId === c.id)
      .reduce((s, t) => s + t.amount, 0)
    html += `<span class="tab-item"><button class="tab${activeCard === c.id ? " active" : ""}" onclick="setCard('${c.id}')"><span class="card-dot" style="background:${cardColor(c.id)}"></span>${escH(c.name)} <span style="color:var(--color-text-secondary);font-weight:400">$${tot.toFixed(2)}</span></button><button class="tab-delete" onclick="deleteCardConfirm(event,'${c.id}')" title="Delete card">✕</button></span>`
  })

  html += `<button class="tab add-card" onclick="openAddCard()" title="Add card">+</button>`
  document.getElementById("tabs-row").innerHTML = html
}

function deleteCardConfirm(event, id) {
  event.stopPropagation()
  deleteCard(id)
}

function deleteCard(id) {
  const card = cards.find(c => c.id === id)
  if (!card) return

  const linkedCount = txns.filter(t => t.cardId === id).length
  const message = linkedCount
    ? `Deleting "${escH(card.name)}" will also remove ${linkedCount} transaction${linkedCount !== 1 ? "s" : ""}.`
    : `Delete card "${escH(card.name)}"?`

  showModal(`<div class="modal">
    <h3>Delete card</h3>
    <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.75rem">${message}</p>
    <div class="modal-btns"><button class="btn-cancel" onclick="closeModal()">Cancel</button><button class="btn-save" onclick="confirmDeleteCard('${id}')">Delete</button></div>
  </div>`)
}

function confirmDeleteCard(id) {
  cards = cards.filter(c => c.id !== id)
  txns = txns.filter(t => t.cardId !== id)
  if (activeCard === id) activeCard = "all"
  save()
  render()
  closeModal()
}

function renderToolbar() {
  const ms = months()
  let mOpts =
    `<option value="all">All months</option>` +
    ms
      .map(m => {
        const [y, mo] = m.split("-")
        const label = new Date(y, mo - 1).toLocaleString("default", {
          month: "long",
          year: "numeric",
        })
        return `<option value="${m}"${activeMonth === m ? " selected" : ""}>${label}</option>`
      })
      .join("")

  const dot = col =>
    `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};margin-right:5px"></span>`
  const labels = [
    ["all", "All", ""],
    ["necessary", "Necessary", dot("#639922")],
    ["useful", "Useful", dot("#BA7517")],
    ["impulsive", "Impulsive", dot("#E24B4A")],
    ["unlabeled", "Unlabeled", ""],
  ]

  document.getElementById("toolbar").innerHTML =
    labels
      .map(
        ([v, l, icon]) =>
          `<button class="filter-btn${activeLabel === v ? " active" : ""}" onclick="setLabel('${v}')">${icon}${l}</button>`,
      )
      .join("") +
    `<select class="month-select" onchange="setMonth(this.value)">${mOpts}</select>`
}

function renderTable() {
  const rows = filteredTxns().sort((a, b) => b.date.localeCompare(a.date))
  const tbody = document.getElementById("tbody")
  const empty = document.getElementById("empty-msg")
  const showCard = activeCard === "all"

  document.getElementById("thead").innerHTML = `<tr>
    <th class="col-label">Label</th><th class="col-date">Date</th><th class="col-merchant">Merchant</th><th class="col-note">Note</th>
    <th class="col-amount">Amount</th>${showCard ? '<th class="col-card">Card</th>' : ""}
    <th class="col-act"></th></tr>`

  if (!rows.length) {
    tbody.innerHTML = ""
    empty.style.display = ""
    return
  }

  empty.style.display = "none"
  tbody.innerHTML = rows
    .map(t => {
      const labelClass = `label-${t.label || "unlabeled"}`
      return `<tr class="${labelClass}">
    <td class="col-label" style="border-left:5px solid ${cardColor(t.cardId)};padding-left:10px">${labelBadge(t)}</td>
    <td class="col-date"><input class="cell-input" value="${escH(t.date)}" onblur="upd('${t.id}','date',this.value)"></td>
    <td class="col-merchant"><input class="cell-input" value="${escH(t.merchant)}" onblur="upd('${t.id}','merchant',this.value)"></td>
    <td class="col-note"><input class="cell-input" value="${escH(t.note || "")}" placeholder="add note…" onblur="upd('${t.id}','note',this.value)"></td>
    <td class="col-amount" style="text-align:right;font-variant-numeric:tabular-nums">$${t.amount.toFixed(2)}</td>
    ${showCard ? `<td class="col-card"><span class="card-dot" style="background:${cardColor(t.cardId)}"></span><select style="font-size:12px;border:none;background:transparent;color:var(--color-text-primary);font-family:var(--font-sans);cursor:pointer" onchange="upd('${t.id}','cardId',this.value)">${cards.map(c => `<option value="${c.id}"${t.cardId === c.id ? " selected" : ""}>${escH(c.name)}</option>`).join("")}</select></td>` : ""}
    <td class="col-act"><button class="del-btn" onclick="delT('${t.id}')">✕</button></td>
  </tr>`
    })
    .join("")
}

function labelBadge(t) {
  const cycle = {
    "": "necessary",
    necessary: "useful",
    useful: "impulsive",
    impulsive: "",
  }
  const names = {
    necessary: "Necessary",
    useful: "Useful",
    impulsive: "Impulsive",
    "": "Unlabeled",
  }
  return `<span class="badge ${t.label || "unlabeled"}" onclick="cycleLabel('${t.id}')">${names[t.label || ""]}</span>`
}

function cycleLabel(id) {
  const t = txns.find(x => x.id === id)
  if (!t) return
  const cycle = {
    "": "necessary",
    necessary: "useful",
    useful: "impulsive",
    impulsive: "",
  }
  t.label = cycle[t.label || ""]
  save()
  render()
}

function upd(id, field, val) {
  const t = txns.find(x => x.id === id)
  if (!t) return
  t[field] = val
  save()
  render()
}

function delT(id) {
  txns = txns.filter(x => x.id !== id)
  save()
  render()
}

function setCard(v) {
  activeCard = v
  render()
}

function setLabel(v) {
  activeLabel = v
  render()
}

function setMonth(v) {
  activeMonth = v
  render()
}

function showModal(html) {
  document.getElementById("modal-wrap").innerHTML =
    `<div class="modal-overlay" id="mov" onclick="closeMov(event)">${html}</div>`
}

function closeMov(e) {
  if (e.target.id === "mov") closeModal()
}

function closeModal() {
  document.getElementById("modal-wrap").innerHTML = ""
}

function openAdd() {
  const cardOpts = cards
    .map(c => `<option value="${c.id}">${escH(c.name)}</option>`)
    .join("")
  showModal(`<div class="modal">
    <h3>Add transaction</h3>
    <div class="field"><label>Date</label><input id="f-date" type="text" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="field"><label>Merchant</label><input id="f-merchant" type="text"></div>
    <div class="field"><label>Note (optional)</label><input id="f-note" type="text"></div>
    <div class="field"><label>Amount ($)</label><input id="f-amount" type="text"></div>
    <div class="field"><label>Card</label><select id="f-card">${cardOpts}</select></div>
    <div class="field"><label>Label</label><select id="f-label"><option value="">— unlabeled —</option><option value="necessary">Necessary</option><option value="useful">Useful</option><option value="impulsive">Impulsive</option></select></div>
    <div class="modal-btns"><button class="btn-cancel" onclick="closeModal()">Cancel</button><button class="btn-save" onclick="saveAdd()">Save</button></div>
  </div>`)
}

function saveAdd() {
  const date = document.getElementById("f-date").value.trim()
  const merchant = document.getElementById("f-merchant").value.trim()
  const note = document.getElementById("f-note").value.trim()
  const amount = parseFloat(document.getElementById("f-amount").value)
  const cardId = document.getElementById("f-card").value
  const label = document.getElementById("f-label").value
  if (!merchant || isNaN(amount)) return
  txns.unshift({ id: uid(), date, merchant, note, amount, cardId, label })
  save()
  render()
  closeModal()
}

function openAddCard() {
  showModal(`<div class="modal">
    <h3>Add card</h3>
    <div class="field"><label>Card name</label><input id="nc-name" type="text" placeholder="Chase Freedom"></div>
    <div class="modal-btns"><button class="btn-cancel" onclick="closeModal()">Cancel</button><button class="btn-save" onclick="saveCard()">Add</button></div>
  </div>`)
}

function saveCard() {
  const name = document.getElementById("nc-name").value.trim()
  if (!name) return
  cards.push({ id: uid(), name })
  save()
  render()
  closeModal()
}

function openImport() {
  const cardOpts = cards
    .map(c => `<option value="${c.id}">${escH(c.name)}</option>`)
    .join("")
  showModal(`<div class="modal">
    <h3>Import CSV</h3>
    <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.75rem">Expected columns: Status, Date, Description, Debit, Credit, Member Name. Header row is supported. Rows that are skipped can be reviewed and imported manually.</p>
    <div class="field"><label>Assign to card</label><div style="display:flex;gap:8px;align-items:center;"><select id="imp-card">${cardOpts}</select><button class="btn" type="button" onclick="showImportAddCard()">+ Card</button></div></div>
    <div class="field" id="imp-new-card-section" style="display:none;">
      <label>New card name</label>
      <input id="imp-new-card-name" type="text" placeholder="Chase Freedom" />
      <div class="modal-btns" style="justify-content:flex-start;margin-top:0.5rem;padding:0;">
        <button class="btn" type="button" onclick="confirmAddCardFromImport()">Add card</button>
        <button class="btn-cancel" type="button" onclick="hideImportAddCard()">Cancel</button>
      </div>
    </div>
    <div class="field"><textarea id="csv-txt" rows="7" style="font-family:var(--font-mono);font-size:12px" placeholder="Posted,2025-04-01,Starbucks,6.50,,John Doe\nPosted,2025-04-03,Netflix,,15.99,John Doe"></textarea></div>
    <div id="imp-result"></div>
    <div class="modal-btns"><button class="btn-cancel" onclick="closeModal()">Close</button><button class="btn-save" onclick="doImport()">Import</button></div>
  </div>`)
}

function showImportAddCard() {
  const section = document.getElementById("imp-new-card-section")
  if (section) section.style.display = "block"
}

function hideImportAddCard() {
  const section = document.getElementById("imp-new-card-section")
  if (section) section.style.display = "none"
}

function confirmAddCardFromImport() {
  const name = document.getElementById("imp-new-card-name").value.trim()
  if (!name) return
  const id = uid()
  cards.push({ id, name })
  save()
  renderTabs()
  const select = document.getElementById("imp-card")
  if (select) {
    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${id}" selected>${escH(name)}</option>`,
    )
    select.value = id
  }
  hideImportAddCard()
  document.getElementById("imp-new-card-name").value = ""
}

function parseCsvLine(line) {
  const values = []
  let current = ""
  let insideQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        insideQuotes = !insideQuotes
      }
    } else if (char === "," && !insideQuotes) {
      values.push(current)
      current = ""
    } else {
      current += char
    }
  }

  values.push(current)
  return values.map(v => v.trim())
}

function doImport() {
  const cardId = document.getElementById("imp-card").value
  const text = document.getElementById("csv-txt").value.trim()
  const rows = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l)

  const known = existingFingerprints()
  pendingImportRows = rows
    .map((line, index) => {
      const cols = parseCsvLine(line)
      if (
        index === 0 &&
        /status/i.test(cols[0]) &&
        /date/i.test(cols[1]) &&
        /description/i.test(cols[2])
      ) {
        return null
      }

      const [
        ,
        date = "",
        description = "",
        debit = "",
        credit = "",
        member = "",
      ] = cols
      const rawAmt = debit || credit || ""
      const amount = parseFloat(rawAmt.replace(/[^0-9.-]/g, ""))
      const merchant = description || ""
      const fp = fingerprint(date, merchant, amount, cardId)
      const isInvalid = !date || !description || isNaN(amount)
      const isDuplicate = !isInvalid && known.has(fp)

      return {
        date: date || "",
        description: description || "",
        debit: debit || "",
        credit: credit || "",
        member: member || "",
        amount: isNaN(amount) ? "" : amount.toString(),
        merchant,
        note: "",
        status: isInvalid ? "invalid" : isDuplicate ? "duplicate" : "ok",
        reason: isInvalid
          ? "Invalid date, description, or amount"
          : isDuplicate
            ? "Duplicate transaction"
            : "Ready to import",
        include: !isInvalid && !isDuplicate,
      }
    })
    .filter(Boolean)

  if (!pendingImportRows.length) {
    return
  }

  const needsReview = pendingImportRows.some(row => row.status !== "ok")
  if (needsReview) {
    renderImportReview(cardId)
    return
  }

  lastImportedTxnIds = []
  pendingImportRows.forEach(row => {
    const id = uid()
    txns.unshift({
      id,
      date: row.date,
      merchant: row.merchant,
      note: row.note,
      amount: parseFloat(row.amount),
      cardId,
      label: "",
    })
    lastImportedTxnIds.push(id)
  })

  save()
  render()
  const resultDiv = document.getElementById("imp-result")
  if (resultDiv) {
    resultDiv.innerHTML = `<div class="import-result ok">${pendingImportRows.length} transaction${pendingImportRows.length !== 1 ? "s" : ""} imported</div>${pendingImportRows.length ? `<button class="btn" onclick="undoImport()">Undo import</button>` : ""}`
  }
  document.getElementById("csv-txt").value = ""
  document.querySelector(".btn-save").textContent = "Import more"
}

function renderImportReview(cardId) {
  const rowsHtml = pendingImportRows
    .map((row, index) => {
      return `<div style="border:1px solid var(--color-border-secondary);border-radius:8px;padding:0.85rem;margin-bottom:0.75rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:0.5rem;flex-wrap:wrap;">
          <label style="font-size:13px;display:flex;align-items:center;gap:6px;"><input type="checkbox" class="imp-include" data-index="${index}" ${row.include ? "checked" : ""}> Include</label>
          <span style="font-size:12px;color:${row.status === "ok" ? "var(--color-text-secondary)" : "#b34141"};">${escH(row.reason)}</span>
        </div>
        <div class="field"><label>Date</label><input id="imp-date-${index}" type="text" value="${escH(row.date)}"></div>
        <div class="field"><label>Description</label><input id="imp-description-${index}" type="text" value="${escH(row.description)}"></div>
        <div class="field"><label>Amount</label><input id="imp-amount-${index}" type="text" value="${escH(row.amount)}"></div>
      </div>`
    })
    .join("")

  showModal(`<div class="modal" style="max-height:80vh;overflow:auto;">
    <h3>Review import rows</h3>
    <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.75rem">Rows that are skipped are unchecked by default. Edit values and check the rows you want to import.</p>
    ${rowsHtml}
    <div class="modal-btns"><button class="btn-cancel" onclick="closeModal()">Cancel</button><button class="btn-save" onclick="importSelectedRows('${cardId}')">Import selected</button></div>
  </div>`)
}

function importSelectedRows(cardId) {
  let added = 0
  let skipped = 0
  let invalid = 0

  pendingImportRows.forEach((row, index) => {
    const includeEl = document.querySelector(
      `.imp-include[data-index="${index}"]`,
    )
    const include = includeEl && includeEl.checked
    if (!include) {
      skipped++
      return
    }

    const date = document.getElementById(`imp-date-${index}`).value.trim()
    const description = document
      .getElementById(`imp-description-${index}`)
      .value.trim()
    const amountRaw = document
      .getElementById(`imp-amount-${index}`)
      .value.trim()
    const amount = parseFloat(amountRaw.replace(/[^0-9.-]/g, ""))
    if (!date || !description || isNaN(amount)) {
      invalid++
      return
    }

    const id = uid()
    txns.unshift({
      id,
      date,
      merchant: description,
      note: "",
      amount,
      cardId,
      label: "",
    })
    lastImportedTxnIds.push(id)
    added++
  })

  save()
  render()
  showModal(`<div class="modal">
    <h3>Import result</h3>
    <div class="import-result ${invalid || skipped ? "warn" : "ok"}">${escH(`${added} transaction${added !== 1 ? "s" : ""} imported${skipped ? `, ${skipped} skipped` : ""}${invalid ? `, ${invalid} invalid` : ""}`)}</div>
    <div class="modal-btns">
      <button class="btn-save" onclick="closeModal()">Close</button>
      ${added ? `<button class="btn" onclick="undoImport()">Undo import</button>` : ""}
    </div>
  </div>`)
}

function undoImport() {
  if (!lastImportedTxnIds.length) return
  txns = txns.filter(t => !lastImportedTxnIds.includes(t.id))
  lastImportedTxnIds = []
  save()
  render()
  showModal(`<div class="modal">
    <h3>Undo complete</h3>
    <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:.75rem">The most recent imported transactions have been removed.</p>
    <div class="modal-btns"><button class="btn-save" onclick="closeModal()">Close</button></div>
  </div>`)
}

load()
