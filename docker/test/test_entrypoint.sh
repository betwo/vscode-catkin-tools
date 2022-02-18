#!/bin/bash -ex
echo "Setting up dbus"
eval `dbus-launch --sh-syntax --config-file=/workspace/docker/config/dbus-system.conf`

exec "$@"