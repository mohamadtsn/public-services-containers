#!/bin/sh

ME=$(basename "$0")
KEY=/etc/ssl/private/main-nginx-selfsigned.key
CERT=/etc/ssl/certs/main-nginx-selfsigned.crt

if [ -f $KEY ] && [ -f $CERT ]; then
    echo "$ME: Server certificate already exists, do nothing."
else
    mkdir -p ~/local_certificates \
    && cd ~/local_certificates \
    && openssl req -new -x509 -nodes -sha256 \
      -days 4650 -newkey rsa:2048 -keyout $KEY \
      -out $CERT -extensions SAN \
      -config "/scripts/configs/auto.openssl.conf";


    cp $CERT /etc/ssl/custom/main-nginx-selfsigned.crt \
    && cp $KEY /etc/ssl/custom/main-nginx-selfsigned.key;
    echo "$ME: Server certificate has been generated."
fi