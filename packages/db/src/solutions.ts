/* ============================================================================
   Known-correct solutions, one per seeded problem (§8, "The bot")

   The bot submits these through the real judge rather than having a scripted
   outcome, so a bot match exercises exactly the same path a human match does.
   A scripted bot would leave the real path untested precisely where it matters.

   They live in reviewed source rather than a database column for the same
   reason validators do, and they double as executable reference
   implementations: `pnpm db:solutions` runs every one through the judge and
   fails if any is not ACCEPTED. A solution that does not pass its own problem's
   tests is a seed-data bug, and it gets caught by running rather than reading.

   Python 3 throughout: it compiles instantly, so a bot submission does not tie
   up a judge slot for five seconds the way C++ does.
   ========================================================================= */

export const SOLUTIONS: Record<string, string> = {
  "sum-of-two": `import sys
a, b = map(int, sys.stdin.read().split())
print(a + b)
`,

  "gcd-pair": `import sys, math
a, b = map(int, sys.stdin.read().split())
print(math.gcd(a, b))
`,

  "fizzbuzz-count": `import sys
n = int(sys.stdin.read())
print(n // 3 + n // 5 - n // 15)
`,

  "sieve-count": `import sys
n = int(sys.stdin.read())
sieve = bytearray([1]) * (n + 1)
sieve[0:2] = b"\\x00\\x00"
i = 2
while i * i <= n:
    if sieve[i]:
        sieve[i * i :: i] = bytearray(len(sieve[i * i :: i]))
    i += 1
print(sum(sieve))
`,

  "modular-power": `import sys
a, b, m = map(int, sys.stdin.read().split())
print(pow(a, b, m))
`,

  "count-vowels": `import sys
s = sys.stdin.read().strip()
print(sum(1 for c in s if c in "aeiou"))
`,

  "longest-common-prefix": `import sys
data = sys.stdin.read().split()
words = data[1:]
k = 0
if words:
    first = words[0]
    while k < len(first) and all(k < len(w) and w[k] == first[k] for w in words):
        k += 1
print(k)
`,

  "edit-distance": `import sys
a, b = sys.stdin.read().split()
prev = list(range(len(b) + 1))
for i in range(1, len(a) + 1):
    cur = [i] + [0] * len(b)
    for j in range(1, len(b) + 1):
        cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
    prev = cur
print(prev[len(b)])
`,

  "max-subarray-sum": `import sys
data = list(map(int, sys.stdin.read().split()))
a = data[1 : 1 + data[0]]
best = cur = a[0]
for x in a[1:]:
    cur = max(x, cur + x)
    best = max(best, cur)
print(best)
`,

  "coin-change-min": `import sys
data = list(map(int, sys.stdin.read().split()))
n, target = data[0], data[1]
coins = data[2 : 2 + n]
INF = float("inf")
dp = [0] + [INF] * target
for v in range(1, target + 1):
    for c in coins:
        if c <= v and dp[v - c] + 1 < dp[v]:
            dp[v] = dp[v - c] + 1
print(-1 if dp[target] == INF else dp[target])
`,

  "longest-increasing-subsequence": `import sys, bisect
data = list(map(int, sys.stdin.read().split()))
a = data[1 : 1 + data[0]]
tails = []
for x in a:
    i = bisect.bisect_left(tails, x)
    if i == len(tails):
        tails.append(x)
    else:
        tails[i] = x
print(len(tails))
`,

  "kth-smallest-pair": `import sys
data = list(map(int, sys.stdin.read().split()))
n, k = data[0], data[1]
a = sorted(data[2 : 2 + n])
print(a[k - 1])
`,

  "palindrome-min-cut": `import sys
s = sys.stdin.read().strip()
n = len(s)
pal = [[False] * n for _ in range(n)]
for i in range(n - 1, -1, -1):
    for j in range(i, n):
        if s[i] == s[j] and (j - i < 2 or pal[i + 1][j - 1]):
            pal[i][j] = True
INF = float("inf")
dp = [INF] * n
for j in range(n):
    if pal[0][j]:
        dp[j] = 0
    else:
        for i in range(1, j + 1):
            if pal[i][j] and dp[i - 1] + 1 < dp[j]:
                dp[j] = dp[i - 1] + 1
print(dp[n - 1])
`,

  "activity-selection": `import sys
data = list(map(int, sys.stdin.read().split()))
n = data[0]
iv = sorted(
    ((data[1 + i * 2], data[2 + i * 2]) for i in range(n)), key=lambda p: p[1]
)
count = 0
last = float("-inf")
for start, end in iv:
    if start >= last:
        count += 1
        last = end
print(count)
`,

  "min-platforms": `import sys
data = list(map(int, sys.stdin.read().split()))
n = data[0]
events = []
for i in range(n):
    events.append((data[1 + i * 2], 1))
    events.append((data[2 + i * 2], -1))
# Arrivals sort before departures at equal time: the statement says a train
# departing at t and another arriving at t DO overlap.
events.sort(key=lambda e: (e[0], -e[1]))
cur = best = 0
for _, delta in events:
    cur += delta
    best = max(best, cur)
print(best)
`,

  "fractional-knapsack": `import sys
data = list(map(int, sys.stdin.read().split()))
n, cap = data[0], data[1]
items = [(data[2 + i * 2], data[3 + i * 2]) for i in range(n)]
items.sort(key=lambda it: it[0] / it[1], reverse=True)
total = 0.0
for value, weight in items:
    if cap <= 0:
        break
    take = min(cap, weight)
    total += value * take / weight
    cap -= take
print(int(total + 1e-9))
`,

  "connected-components": `import sys
data = list(map(int, sys.stdin.read().split()))
n, m = data[0], data[1]
parent = list(range(n + 1))

def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x

for e in range(m):
    a, b = find(data[2 + e * 2]), find(data[3 + e * 2])
    if a != b:
        parent[a] = b
print(len({find(v) for v in range(1, n + 1)}))
`,

  "shortest-path-bfs": `import sys
from collections import deque
data = list(map(int, sys.stdin.read().split()))
n, m = data[0], data[1]
adj = [[] for _ in range(n + 1)]
for e in range(m):
    u, v = data[2 + e * 2], data[3 + e * 2]
    adj[u].append(v)
    adj[v].append(u)
src, dst = data[2 + m * 2], data[3 + m * 2]
dist = [-1] * (n + 1)
dist[src] = 0
q = deque([src])
while q:
    u = q.popleft()
    for v in adj[u]:
        if dist[v] == -1:
            dist[v] = dist[u] + 1
            q.append(v)
print(dist[dst])
`,

  "topological-order": `import sys
from collections import deque
data = list(map(int, sys.stdin.read().split()))
n, m = data[0], data[1]
adj = [[] for _ in range(n + 1)]
indeg = [0] * (n + 1)
for e in range(m):
    u, v = data[2 + e * 2], data[3 + e * 2]
    adj[u].append(v)
    indeg[v] += 1
q = deque(v for v in range(1, n + 1) if indeg[v] == 0)
seen = 0
while q:
    u = q.popleft()
    seen += 1
    for v in adj[u]:
        indeg[v] -= 1
        if indeg[v] == 0:
            q.append(v)
print("YES" if seen == n else "NO")
`,

  "dijkstra-shortest": `import sys, heapq
data = list(map(int, sys.stdin.read().split()))
n, m = data[0], data[1]
adj = [[] for _ in range(n + 1)]
for e in range(m):
    u, v, w = data[2 + e * 3], data[3 + e * 3], data[4 + e * 3]
    adj[u].append((v, w))
    adj[v].append((u, w))
src, dst = data[2 + m * 3], data[3 + m * 3]
INF = float("inf")
dist = [INF] * (n + 1)
dist[src] = 0
pq = [(0, src)]
while pq:
    d, u = heapq.heappop(pq)
    if d > dist[u]:
        continue
    for v, w in adj[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            heapq.heappush(pq, (dist[v], v))
print(-1 if dist[dst] == INF else dist[dst])
`,
};

export function solutionFor(slug: string): string {
  const source = SOLUTIONS[slug];
  if (!source) {
    // A problem the bot cannot solve is a problem the bot must never be given.
    throw new Error(`No bot solution for problem "${slug}"`);
  }
  return source;
}

export const SOLVED_SLUGS = Object.keys(SOLUTIONS);
