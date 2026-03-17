lsof -ti :7001 -ti :5080 | xargs kill -9 2>/dev/null; echo "Ports 7001 and 5080 cleared."
