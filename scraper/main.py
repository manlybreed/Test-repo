import requests
from bs4 import BeautifulSoup

def main():
    url = "http://olympus.realpython.org/profiles/aphrodite"
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')
    print('Title:', soup.title.string)

if __name__ == '__main__':
    main() 