package main

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Built once while the image is made, so go test's own machinery is already compiled when a player's job runs.
func TestWarm(t *testing.T) {
	var wg sync.WaitGroup
	_ = errors.New(fmt.Sprint(strconv.Itoa(1), strings.ToUpper("a"), time.Millisecond))
	sort.Ints([]int{1})
	wg.Wait()
}
