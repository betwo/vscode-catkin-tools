#!/bin/bash -ex
echo "Setting up dbus"
cat /workspace/docker/config/dbus-system.conf
eval `dbus-launch --sh-syntax --config-file=/workspace/docker/config/dbus-system.conf`

exec "$@"