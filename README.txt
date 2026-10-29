Managed Java runtimes are NOT stored here by default.

Each Temurin JRE is 50-160 MB and the panel re-downloads one whenever a server
needs it, so they live outside the project folder:

    JAVA_DIR=/var/lib/zenith/java     (installs done as root by install.sh)
    JAVA_DIR=~/.zenith/java           (non-root installs)
    JAVA_DIR=/var/tmp/zenith/java     (this workspace's dev panel)

Everything the panel no longer needs can be deleted from
Admin -> Java -> Disk usage ("Free ...") or POST /api/system/java/prune.
