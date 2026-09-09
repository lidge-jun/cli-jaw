# Service-only zsh forwarding. Keep user configs at top level (no function scope).
# Reapply the verified bin after each usual config; this is not a shell sandbox.
# Bash/other shells, zsh -f, config exit/exec, and later PATH edits are not covered.
if [[ -n ${CLI_JAW_ZSH_SHIMS-} && -n ${CLI_JAW_VERIFIED_BIN-} ]]; then
    if [[ ${CLI_JAW_USER_ZDOTDIR_SET-0} == 1 ]]; then
        export ZDOTDIR="${CLI_JAW_USER_ZDOTDIR-}"
    else
        unset ZDOTDIR
    fi
    _CLI_JAW_ZSH_USER_FILE="${ZDOTDIR-${HOME}}/.zshrc"
    if [[ -r "$_CLI_JAW_ZSH_USER_FILE" && "${_CLI_JAW_ZSH_USER_FILE:A}" != "${CLI_JAW_ZSH_SHIMS:A}/.zshrc" ]]; then
        source "$_CLI_JAW_ZSH_USER_FILE"
    fi
    # Honor a user's ZDOTDIR reassignment for subsequent config files.
    if (( ${+ZDOTDIR} )); then
        export CLI_JAW_USER_ZDOTDIR_SET=1 CLI_JAW_USER_ZDOTDIR="$ZDOTDIR"
    else
        export CLI_JAW_USER_ZDOTDIR_SET=0 CLI_JAW_USER_ZDOTDIR=''
    fi
    unset _CLI_JAW_ZSH_USER_FILE
    export ZDOTDIR="$CLI_JAW_ZSH_SHIMS"
    export PATH="$CLI_JAW_VERIFIED_BIN${PATH:+:$PATH}"
fi
