package backup

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os/exec"
)

type Dumper interface {
	Dump(ctx context.Context, databaseURL string, dst io.Writer) error
}

type PgDumper struct{}

func (PgDumper) Dump(ctx context.Context, databaseURL string, dst io.Writer) error {
	cmd := exec.CommandContext(ctx, "pg_dump", databaseURL)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	gz := gzip.NewWriter(dst)
	_, copyErr := io.Copy(gz, stdout)
	closeErr := gz.Close()
	errBytes, _ := io.ReadAll(stderr)
	waitErr := cmd.Wait()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if waitErr != nil {
		return fmt.Errorf("pg_dump failed: %w: %s", waitErr, string(errBytes))
	}
	return nil
}
