SED=`which sed`
CURRENT_DIR=`dirname "$0"`
PREVIOUS_DIR=`(cd .. && pwd)`
CONF_DIR="${PREVIOUS_DIR}/site-enabled"
CERTIFICATE_NAME_FILE="cert_file"
#echo "$SSL_DIR"
#echo "$CURRENT_DIR"
echo "What is the domain?"
#sleep 5m
read DOMAIN

# check the domain is valid!
PATTERN="^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$";
if [[ "$DOMAIN" =~ $PATTERN ]]; then
	DOMAIN=`echo "$DOMAIN" | tr '[A-Z]' '[a-z]'`
	echo "Creating hosting for:" "$DOMAIN"
else
	echo "invalid domain name"
	exit 1
fi

echo "What is the port host?"
read PORT

printf 'Is the entered host a subdomain (y/n)? '
read isSubdomain
if [ "$isSubdomain" != "${isSubdomain#[Yy]}" ] ;then
    echo "enter your main domain: "
    read MainDomain
    CERTIFICATE_NAME_FILE="$MainDomain"
else
    CERTIFICATE_NAME_FILE="$DOMAIN"
fi

CONFIG=$CONF_DIR/$DOMAIN.conf
rm -rf "$CONFIG"
cp "$CURRENT_DIR"/template.stub "$CONFIG"
"$SED" -i "s/{{DOMAIN}}/$DOMAIN/g" "$CONFIG"
"$SED" -i "s/{{CERTIFICATE_NAME_FILE}}/$CERTIFICATE_NAME_FILE/g" "$CONFIG"
"$SED" -i "s/{{PORT}}/$PORT/g" "$CONFIG"

docker exec -it nginx-main nginx -s reload
echo "**Creating hosting for:" "$DOMAIN" "Finished!**"
sleep 5s