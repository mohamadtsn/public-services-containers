FROM nginx:latest

RUN apt -y update \
    && apt -y install nano \
    && apt -y install openssl \
    && mkdir -p "/var/lib/nginx/cache/public/" \
    && mkdir -p "/var/lib/nginx/cache/private";

#RUN cd ~/ \
#    && openssl req -x509 -nodes \
#          -days 365 \
#          -subj "/C=CA/ST=QC/O=Company, Inc./CN=maindomain.test" \
#          -addext "subjectAltName=DNS:maindomain.test" \
#          -newkey rsa:2048 \
#          -keyout /etc/ssl/private/nginx-selfsigned.key \
#          -out /etc/ssl/certs/nginx-selfsigned.crt;

COPY site-enabled/default.conf /etc/nginx/conf.d/default.conf

#COPY ssl/ssl-certs-generator.sh /docker-entrypoint.d/99-generate-ssl-cert.sh
#COPY ssl/ssl-certs-generator.sh /scripts/generate-ssl-cert.sh
#COPY ssl/auto.openssl.conf /scripts/configs/auto.openssl.conf
#RUN chmod 777 /docker-entrypoint.d/99-generate-ssl-cert.sh
#RUN chmod 777 /scripts/generate-ssl-cert.sh
#RUN chmod 777 /scripts/configs/auto.openssl.conf

#RUN /scripts/generate-ssl-cert.sh

#COPY settings/nginx.conf /etc/nginx/nginx.conf
COPY settings/mime.types /etc/nginx/mime.types