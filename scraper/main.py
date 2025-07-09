import requests
from bs4 import BeautifulSoup
import logging

# Set up basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    url = "http://olympus.realpython.org/profiles/aphrodite"
    logging.info(f"Sending request to {url}")
    headers = {"User-Agent": "Mozilla/5.0"}
    response = requests.get(url)
    logging.info("Response received, parsing HTML")
    soup = BeautifulSoup(response.text, 'html.parser')
    title = soup.title.string
    logging.info(f"Page title: {title}")

if __name__ == "__main__":
    main()