docker run -d \
  --name oracle-db \
  -p 1521:1521 \
  -e ORACLE_PWD=your_password \
  container-registry.oracle.com/database/express:21.3.0-xe