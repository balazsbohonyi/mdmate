//! What git says about the files under a workspace root, for the colours of the tree (P9.1-T27).
//!
//! The work is split the way it can fail: `locate` finds the program, `discover` finds the
//! repositories under a root (several can sit under one, and one can hold another), `run` starts
//! git for each of them without a console window, under a timeout and a small cap on how many run at
//! once, `status` reads its porcelain output into one status per path, and `command` puts them
//! together behind the page's one question. Git is the program the owner installed and is only ever
//! asked to read: `status --no-optional-locks` takes no lock and writes nothing, and nothing here
//! reads a `.gitignore` itself. Whatever goes wrong (no git, a timeout, an error exit, a folder git
//! calls unsafe) leaves that repository without colours and shows no error.

pub(crate) mod command;
mod discover;
mod locate;
mod run;
mod status;
#[cfg(test)]
mod testing;
