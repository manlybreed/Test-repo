# Python Scraping & Git Learning Project

This project is designed to help you learn the basics of web scraping with Python and version control using Git.

## Project Structure
- `scraper/` - Main package for scraping code
- `tests/` - Unit tests for the scraper
- `requirements.txt` - Python dependencies
- `README.md` - Project documentation

## Getting Started
1. Clone this repository.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the scraper:
   ```bash
   python -m scraper
   ```

## Learning Goals
- Understand basic web scraping with Python
- Practice using Git for version control

## Requirements
- Python 3.8+
- See `requirements.txt` for dependencies

## License
MIT 

## Git Learning Tasks

Below are branching and version control exercises to help reinforce Git skills:

- [x] Create a new branch `feature/add-logging`, add logging to the scraper, and merge it back to `main`.
- [x] Create a branch `bugfix/fix-headers`, simulate a bug fix in HTTP headers, and open a pull request.
- [x] Create a branch `feature/html-parser`, refactor parsing logic using BeautifulSoup, and tag the version as `v0.2`.
- [x] Create a branch `experiment/alt-parser`, try an alternative parsing method, and discard the branch after review.
- [x] Simulate a merge conflict between two branches and resolve it locally.
- [ ] Create a new branch `feature/title-format`, edit `main.py` to change the title print line (e.g., make it uppercase), commit and push changes, open a PR on GitHub, and merge it back into `main`. Finally, delete the feature branch.

## 🤝 Collaboration Practice (Even Solo)

- [ ] Open an Issue: Suggest an improvement like “Add CLI interface”
- [ ] Self-assign it and reference it in a commit (e.g., `fixes #1`)
- [ ] Use GitHub Projects or a simple Kanban board
- [ ] Create a branch from the issue (`feature/cli-interface`)
- [ ] Merge the completed feature branch into `main` with a PR