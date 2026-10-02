#!/bin/sh
# Firewall rules for vibld on a server of its own (docs/decisions.md D141),
# run at boot after Docker by cloud-init.yaml's vibld-firewall.service.
#
# Docker's own rules come before ufw's, so ports a container publishes are
# open to the internet whatever ufw says. Each preview's sandbox is such a
# container (D137), so these two rules go in Docker's DOCKER-USER chain:
#
# - no new connection from the internet reaches a container: previews are
#   reached only through the proxy and the preview Worker;
# - no container reaches the cloud's metadata service, which serves this
#   server's user data, the keys in it included, to anything that asks.
set -eu
#
# Docker publishes ports on IPv6 too where the server has it, so both go
# into ip6tables as well.
ext=$(ip -o route show default | awk '{ print $5; exit }')
add() {
  table=$1
  shift
  $table -N DOCKER-USER 2>/dev/null || true
  $table -C DOCKER-USER "$@" 2>/dev/null || $table -I DOCKER-USER "$@"
}
add iptables -i "$ext" -m conntrack --ctstate NEW -j DROP
add iptables -d 169.254.169.254 -j DROP
add ip6tables -i "$ext" -m conntrack --ctstate NEW -j DROP
# The metadata service's IPv6 address, where a cloud has one (AWS).
add ip6tables -d fd00:ec2::254 -j DROP
