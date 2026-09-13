# Runs `openclaw fleet` commands from openchat-bridge (gateway-pool.ts) via a one-shot
# `docker run`, with the host's Docker socket and OPENCLAW_STATE_DIR bind-mounted in.
#
# Built FROM the same image tenants' cells actually run, so the fleet CLI version always
# matches the gateway it's managing — rebuild this whenever OPENCLAW_GATEWAY_IMAGE changes:
#
#   docker build --build-arg BASE_IMAGE=openclaw:local -t openclaw-fleet-runner:local .
#
# Must be invoked with matching host paths (`-v <hostDir>:<hostDir>`, not a translated
# path) and `--user <uid>:<gid> --group-add <dockerGid>` — see gateway-pool.ts. Fleet's own
# `docker run` calls for cell containers go through the Docker socket to the *host* daemon,
# so any host path Fleet writes (bind mounts under OPENCLAW_STATE_DIR/fleet/cells/<tenant>)
# must resolve to the same path from both this container's view and the host daemon's view.
ARG BASE_IMAGE=openclaw:local
FROM ${BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["openclaw"]
