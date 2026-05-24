FROM phpmyadmin/phpmyadmin

RUN apt -y update \
    && apt -y install nano \
    && mkdir -p "/etc/phpmyadmin/nginx.conf/custom";



COPY ./nginx/custom/ /etc/phpmyadmin/nginx.conf/

COPY config.inc.php /var/www/html/config.inc.php