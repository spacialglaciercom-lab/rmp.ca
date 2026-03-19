#!/bin/sh
#
# Gradle start up script for POSIX
# Copyright © 2015-2021 the original authors. Licensed under the Apache License, Version 2.0.
#

app_path=$0
while [ -h "$app_path" ]; do
  ls=$(ls -ld "$app_path")
  link=${ls#*' -> '}
  case $link in
    /*) app_path=$link ;;
    *) app_path=$(dirname "$app_path")/$link ;;
  esac
done
APP_HOME=$(cd -P "$(dirname "$app_path")" >/dev/null && pwd) || exit

CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar

if [ -n "$JAVA_HOME" ]; then
  JAVACMD=$JAVA_HOME/bin/java
else
  JAVACMD=java
fi
if [ ! -x "$JAVACMD" ]; then
  echo "ERROR: JAVA_HOME is not set or java not found" >&2
  exit 1
fi

exec "$JAVACMD" -Dfile.encoding=UTF-8 -Xmx64m -Xms64m \
  -Dorg.gradle.appname=gradlew \
  -classpath "$CLASSPATH" \
  org.gradle.wrapper.GradleWrapperMain \
  "$@"
