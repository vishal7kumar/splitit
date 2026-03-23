package handlers

import (
	"math"
	"net/http"
	"sort"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type BalanceHandler struct {
	DB *sqlx.DB
}

type balanceEntry struct {
	UserID  int     `json:"user_id"`
	Name    string  `json:"name"`
	Balance float64 `json:"balance"`
}

type simplifiedDebt struct {
	From       int     `json:"from"`
	FromName   string  `json:"from_name"`
	To         int     `json:"to"`
	ToName     string  `json:"to_name"`
	Amount     float64 `json:"amount"`
}

func (h *BalanceHandler) GroupBalances(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	if !h.isMember(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this group"})
		return
	}

	// Get member names
	type memberInfo struct {
		UserID int    `db:"user_id"`
		Name   string `db:"name"`
	}
	var members []memberInfo
	h.DB.Select(&members,
		`SELECT gm.user_id, u.name FROM group_members gm
		 JOIN users u ON gm.user_id = u.id
		 WHERE gm.group_id = $1`, groupID)
	nameMap := make(map[int]string)
	for _, m := range members {
		nameMap[m.UserID] = m.Name
	}

	// Calculate net balances
	netBalance := make(map[int]float64)

	// Credits from paying
	type amountRow struct {
		UserID int     `db:"user_id"`
		Total  float64 `db:"total"`
	}
	var paidRows []amountRow
	h.DB.Select(&paidRows,
		`SELECT paid_by AS user_id, COALESCE(SUM(amount), 0) AS total
		 FROM expenses WHERE group_id = $1 GROUP BY paid_by`, groupID)
	for _, r := range paidRows {
		netBalance[r.UserID] += r.Total
	}

	// Debits from splits
	var splitRows []amountRow
	h.DB.Select(&splitRows,
		`SELECT es.user_id, COALESCE(SUM(es.share_amount), 0) AS total
		 FROM expense_splits es
		 JOIN expenses e ON es.expense_id = e.id
		 WHERE e.group_id = $1
		 GROUP BY es.user_id`, groupID)
	for _, r := range splitRows {
		netBalance[r.UserID] -= r.Total
	}

	// Settlements: payer (debtor) gets +amount, receiver (creditor) gets -amount
	// because settling reduces the debtor's debt and the creditor's credit
	var settPaid []amountRow
	h.DB.Select(&settPaid,
		`SELECT paid_by AS user_id, COALESCE(SUM(amount), 0) AS total
		 FROM settlements WHERE group_id = $1 GROUP BY paid_by`, groupID)
	for _, r := range settPaid {
		netBalance[r.UserID] += r.Total
	}
	var settReceived []amountRow
	h.DB.Select(&settReceived,
		`SELECT paid_to AS user_id, COALESCE(SUM(amount), 0) AS total
		 FROM settlements WHERE group_id = $1 GROUP BY paid_to`, groupID)
	for _, r := range settReceived {
		netBalance[r.UserID] -= r.Total
	}

	// Build balance list
	var balances []balanceEntry
	for _, m := range members {
		balances = append(balances, balanceEntry{
			UserID:  m.UserID,
			Name:    m.Name,
			Balance: math.Round(netBalance[m.UserID]*100) / 100,
		})
	}

	// Simplify debts
	debts := simplifyDebts(netBalance, nameMap)

	c.JSON(http.StatusOK, gin.H{"balances": balances, "debts": debts})
}

func (h *BalanceHandler) TotalBalance(c *gin.Context) {
	userID := c.GetInt("userID")

	// Get all groups user belongs to
	var groupIDs []int
	h.DB.Select(&groupIDs, "SELECT group_id FROM group_members WHERE user_id = $1", userID)

	totalBalance := 0.0
	type groupBalance struct {
		GroupID  int     `json:"group_id"`
		Name     string  `json:"name"`
		Currency string  `json:"currency"`
		Balance  float64 `json:"balance"`
	}
	var perGroup []groupBalance

	for _, gid := range groupIDs {
		var gName string
		var gCurrency string
		h.DB.Get(&gName, "SELECT name FROM groups WHERE id = $1", gid)
		h.DB.Get(&gCurrency, "SELECT currency FROM groups WHERE id = $1", gid)

		bal := h.calcUserBalance(gid, userID)
		totalBalance += bal
		perGroup = append(perGroup, groupBalance{
			GroupID:  gid,
			Name:     gName,
			Currency: gCurrency,
			Balance:  math.Round(bal*100) / 100,
		})
	}
	if perGroup == nil {
		perGroup = []groupBalance{}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_balance": math.Round(totalBalance*100) / 100,
		"groups":        perGroup,
	})
}

func (h *BalanceHandler) calcUserBalance(groupID, userID int) float64 {
	var paid float64
	h.DB.Get(&paid, `SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE group_id = $1 AND paid_by = $2`, groupID, userID)

	var owed float64
	h.DB.Get(&owed, `SELECT COALESCE(SUM(es.share_amount), 0) FROM expense_splits es JOIN expenses e ON es.expense_id = e.id WHERE e.group_id = $1 AND es.user_id = $2`, groupID, userID)

	var settPaid float64
	h.DB.Get(&settPaid, `SELECT COALESCE(SUM(amount), 0) FROM settlements WHERE group_id = $1 AND paid_by = $2`, groupID, userID)

	var settReceived float64
	h.DB.Get(&settReceived, `SELECT COALESCE(SUM(amount), 0) FROM settlements WHERE group_id = $1 AND paid_to = $2`, groupID, userID)

	return paid - owed + settPaid - settReceived
}

func (h *BalanceHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}

func simplifyDebts(netBalance map[int]float64, nameMap map[int]string) []simplifiedDebt {
	type entry struct {
		id      int
		balance float64
	}

	var creditors, debtors []entry
	for id, bal := range netBalance {
		bal = math.Round(bal*100) / 100
		if bal > 0.01 {
			creditors = append(creditors, entry{id, bal})
		} else if bal < -0.01 {
			debtors = append(debtors, entry{id, -bal})
		}
	}

	// Sort descending by amount
	sort.Slice(creditors, func(i, j int) bool { return creditors[i].balance > creditors[j].balance })
	sort.Slice(debtors, func(i, j int) bool { return debtors[i].balance > debtors[j].balance })

	var debts []simplifiedDebt
	ci, di := 0, 0
	for ci < len(creditors) && di < len(debtors) {
		amount := math.Min(creditors[ci].balance, debtors[di].balance)
		amount = math.Round(amount*100) / 100
		if amount > 0 {
			debts = append(debts, simplifiedDebt{
				From:     debtors[di].id,
				FromName: nameMap[debtors[di].id],
				To:       creditors[ci].id,
				ToName:   nameMap[creditors[ci].id],
				Amount:   amount,
			})
		}
		creditors[ci].balance -= amount
		debtors[di].balance -= amount
		if creditors[ci].balance < 0.01 {
			ci++
		}
		if debtors[di].balance < 0.01 {
			di++
		}
	}
	if debts == nil {
		debts = []simplifiedDebt{}
	}
	return debts
}
