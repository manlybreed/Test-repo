import requests
from bs4 import BeautifulSoup
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def fetch_html(url):
    headers = {"User-Agent": "Mozilla/5.0"}
    logging.info(f"Sending request to {url}")
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.text

def parse_title(html):
    logging.info("Parsing HTML content")
    soup = BeautifulSoup(html, 'html.parser')
    title = soup.title.string if soup.title else "No title found"
    logging.info(f"Page title: {title}")
    return title

def main():
    url = "http://olympus.realpython.org/profiles/aphrodite"
    html = fetch_html(url)
    parse_title(html)

if __name__ == "__main__":
    main()