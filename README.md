# Greyhound Form Lab

A website that shows the top 3 for every Australian greyhound race today, picked on form, times, box draw, age, class, track record and weight. The betting market plays no part.

## How it works

- **The website** (`index.html`) is a single page hosted free on GitHub Pages. Open it on your phone or computer, no login.
- **The collector** (`collector/`) reads each race from thedogs.com.au: the race page, the expert form page, and each dog's recent runs. It saves the day to `data/<date>.json`.
- **GitHub Actions** (`.github/workflows/collect.yml`) runs the collector automatically at about 7:45am, 12:30pm and 4:30pm Melbourne time, and saves the data back to this repo. The site updates within a minute or two.

The ratings are worked out in the page itself, so changing the model only means editing `index.html`.

## One-time setup

1. **Upload these files** to a new public repository called `greyhound-form-lab`.
2. **Turn on the website:** Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save. After a minute the site is at `https://<your-username>.github.io/greyhound-form-lab/`.
3. **Fill today's races now:** Actions tab → *Collect races* → *Run workflow*. (If GitHub asks you to enable workflows first, click the green button.)

After that it runs by itself every day.

## If it stops updating

- Open the Actions tab and look at the latest *Collect races* run. A red cross means it failed; the log says why.
- The most likely cause is thedogs.com.au changing its page layout or blocking automated requests. The parsers live in `collector/parse.mjs`.
- GitHub pauses scheduled runs in repos with no activity for 60 days. The daily data commits count as activity, but if it ever pauses, the Actions tab shows a button to turn it back on.

## Model weights

From most to least important: recent form, best time at the track and distance, early speed (first split), track and distance record, recent margins, box draw, class change, age (peak 2 to 3½ years), consistency, freshness (days since last run), career strike rate, weight change. Change the `W` object near the top of the script in `index.html` to reweight.

A guide, not a guarantee. Gambling Help: 1800 858 858.
