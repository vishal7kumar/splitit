package backup

import "time"

func istLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return time.FixedZone("Asia/Kolkata", 5*60*60+30*60)
	}
	return loc
}

func mostRecentISTMidnight(now time.Time) time.Time {
	ist := now.In(istLocation())
	return time.Date(ist.Year(), ist.Month(), ist.Day(), 0, 0, 0, 0, ist.Location())
}

func nextISTMidnight(now time.Time) time.Time {
	return mostRecentISTMidnight(now).AddDate(0, 0, 1)
}

func backupObjectKey(stage string, scheduledFor time.Time) string {
	ist := scheduledFor.In(istLocation())
	return stage + "/backup_" + ist.Format("20060102_150405") + "_IST.sql.gz"
}
