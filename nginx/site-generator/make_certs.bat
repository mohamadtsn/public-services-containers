@echo off


SET CURRENT_PATH=%~dp0..\certificates\
SET /p HOSTNAME=Enter Your domain: 
SET COUNTRY=US
SET STATE=KS
SET CITY=Olathe
SET ORGANIZATION=IT
SET ORGANIZATION_UNIT=IT Department
SET EMAIL=emailhere@somesite.com
SET THISPROG="C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\certmgr.exe"

(
echo [req]
echo default_bits = 2048
echo prompt = no
echo default_md = sha256
echo x509_extensions = v3_req
echo distinguished_name = dn
echo:
echo [dn]
echo C = %COUNTRY%
echo ST = %STATE%
echo L = %CITY%
echo O = %ORGANIZATION%
echo OU = %ORGANIZATION_UNIT%
echo emailAddress = %EMAIL%
echo CN = %HOSTNAME%
echo:
echo [v3_req]
echo subjectAltName = @alt_names
echo:
echo [alt_names]
echo DNS.1 = *.%HOSTNAME%
echo DNS.2 = %HOSTNAME%
)>%CURRENT_PATH%%HOSTNAME%.cnf

docker exec -it nginx-main mkdir -p /etc/nginx/ssl
docker exec -it nginx-main rm -rf /etc/nginx/ssl/%HOSTNAME%.key
docker exec -it nginx-main rm -rf /etc/nginx/ssl/%HOSTNAME%.crt


openssl req -new -x509 -nodes -sha256 -days 4650 -newkey rsa:2048 -keyout %CURRENT_PATH%%HOSTNAME%.key -out %CURRENT_PATH%%HOSTNAME%.crt -config %CURRENT_PATH%%HOSTNAME%.cnf

docker cp %CURRENT_PATH%%HOSTNAME%.key nginx-main:/etc/nginx/ssl/%HOSTNAME%.key
docker cp %CURRENT_PATH%%HOSTNAME%.crt nginx-main:/etc/nginx/ssl/%HOSTNAME%.crt

%THISPROG% /c /add "%CURRENT_PATH%%HOSTNAME%.crt" /s root

del %CURRENT_PATH%%HOSTNAME%.cnf

docker exec -it nginx-main nginx -s reload
Pause