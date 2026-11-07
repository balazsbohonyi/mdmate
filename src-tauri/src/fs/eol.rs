//! Line endings. A file's text is held with `\n` as the only line break, and the ending each break
//! had on disk travels beside it. Joining the two gives the original bytes back.
//!
//! Only breaks that differ from the file's dominant ending are listed, so a plain CRLF or LF file
//! carries no list at all and a mixed one carries a short one.

use crate::error::AppError;

/// One of the three line breaks `str::lines` and CodeMirror both treat as a break.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Ending {
    Lf,
    CrLf,
    Cr,
}

impl Ending {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "\n",
            Self::CrLf => "\r\n",
            Self::Cr => "\r",
        }
    }

    /// The number the frame format and the page use for this ending.
    pub(crate) fn code(self) -> u32 {
        match self {
            Self::Lf => 0,
            Self::CrLf => 1,
            Self::Cr => 2,
        }
    }

    pub(crate) fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Lf),
            1 => Some(Self::CrLf),
            2 => Some(Self::Cr),
            _ => None,
        }
    }
}

/// The ending of every line break in a text: one `dominant` ending, plus the breaks that differ.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Endings {
    pub(crate) dominant: Ending,
    /// `(break index, ending)` for each break whose ending is not `dominant`, ascending. Break `i`
    /// is the one that ends line `i + 1`.
    pub(crate) exceptions: Vec<(u32, Ending)>,
}

#[cfg(test)]
impl Endings {
    /// A text with no exceptions: every break uses `dominant`.
    pub(crate) fn uniform(dominant: Ending) -> Self {
        Self {
            dominant,
            exceptions: Vec::new(),
        }
    }
}

/// Splits raw text into `\n`-only text and its endings. `\r\n`, `\n` and a lone `\r` are breaks.
/// The dominant ending is the most common one (the first to appear wins a tie), and `\n` when
/// there are no breaks, which keeps new files git-friendly.
pub(crate) fn split(raw: &str) -> (String, Endings) {
    let bytes = raw.as_bytes();
    let mut text = String::with_capacity(raw.len());
    let mut all: Vec<Ending> = Vec::new();
    let mut start = 0;
    let mut i = 0;
    // `\r` and `\n` are ASCII, so they never sit inside a multi-byte character and every slice
    // below starts and ends on a character boundary.
    while i < bytes.len() {
        let ending = match bytes[i] {
            b'\n' => Some((Ending::Lf, 1)),
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => Some((Ending::CrLf, 2)),
            b'\r' => Some((Ending::Cr, 1)),
            _ => None,
        };
        if let Some((ending, width)) = ending {
            text.push_str(&raw[start..i]);
            text.push('\n');
            all.push(ending);
            i += width;
            start = i;
        } else {
            i += 1;
        }
    }
    text.push_str(&raw[start..]);

    let dominant = dominant_of(&all);
    let exceptions = all
        .iter()
        .enumerate()
        .filter(|&(_, &ending)| ending != dominant)
        .filter_map(|(index, &ending)| Some((u32::try_from(index).ok()?, ending)))
        .collect();
    (
        text,
        Endings {
            dominant,
            exceptions,
        },
    )
}

fn dominant_of(all: &[Ending]) -> Ending {
    let mut counts = [0usize; 3];
    let mut first_seen = [usize::MAX; 3];
    for (index, ending) in all.iter().enumerate() {
        let slot = ending.code() as usize;
        counts[slot] += 1;
        if first_seen[slot] == usize::MAX {
            first_seen[slot] = index;
        }
    }
    let mut best = Ending::Lf;
    let mut best_slot = usize::MAX;
    for ending in [Ending::Lf, Ending::CrLf, Ending::Cr] {
        let slot = ending.code() as usize;
        if counts[slot] == 0 {
            continue;
        }
        let better = best_slot == usize::MAX
            || counts[slot] > counts[best_slot]
            || (counts[slot] == counts[best_slot] && first_seen[slot] < first_seen[best_slot]);
        if better {
            best = ending;
            best_slot = slot;
        }
    }
    best
}

/// Puts the endings back. `text` must hold `\n` as its only line break; a stray `\r`, or an
/// exception that points past the last break or is out of order, is refused rather than guessed at.
pub(crate) fn join(text: &str, endings: &Endings) -> Result<String, AppError> {
    if text.contains('\r') {
        return Err(AppError::Invalid(
            "the text holds a carriage return; line breaks must be a plain newline".into(),
        ));
    }
    let breaks = text.bytes().filter(|&byte| byte == b'\n').count();
    let mut previous: Option<u32> = None;
    for &(index, _) in &endings.exceptions {
        let in_order = previous.is_none_or(|p| index > p);
        if !in_order || (index as usize) >= breaks {
            return Err(AppError::Invalid(format!(
                "line ending {index} is out of order or past the last of {breaks} breaks"
            )));
        }
        previous = Some(index);
    }

    let mut out = String::with_capacity(text.len() + breaks);
    let mut next_exception = 0;
    for (index, line) in text.split('\n').enumerate() {
        out.push_str(line);
        if index == breaks {
            break;
        }
        let ending = match endings.exceptions.get(next_exception) {
            Some(&(at, ending)) if at as usize == index => {
                next_exception += 1;
                ending
            }
            _ => endings.dominant,
        };
        out.push_str(ending.as_str());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIXED: &str = "one\r\ntwo\nthree\rstill three\r\n\r\nlast";

    #[test]
    fn splits_mixed_text_into_plain_newlines_and_exceptions() {
        let (text, endings) = split(MIXED);
        assert_eq!(text, "one\ntwo\nthree\nstill three\n\nlast");
        assert_eq!(endings.dominant, Ending::CrLf);
        assert_eq!(endings.exceptions, vec![(1, Ending::Lf), (2, Ending::Cr)]);
    }

    #[test]
    fn joins_back_to_the_exact_input() {
        for raw in [
            MIXED,
            "a\r\nb\r\nc\r\n",
            "a\nb\nc",
            "a\rb\rc\r",
            "",
            "\r\n",
            "\r\n\n\r\r\n",
            "no breaks at all",
            "caf\u{e9}\r\n\u{1F600}\n",
        ] {
            let (text, endings) = split(raw);
            assert_eq!(join(&text, &endings).expect("a split text joins"), raw);
        }
    }

    #[test]
    fn uniform_files_carry_no_exceptions() {
        assert!(split("a\r\nb\r\nc\r\n").1.exceptions.is_empty());
        assert!(split("a\nb\nc").1.exceptions.is_empty());
        assert_eq!(split("a\rb\rc").1.dominant, Ending::Cr);
    }

    #[test]
    fn text_without_breaks_defaults_to_lf() {
        assert_eq!(split("one line").1.dominant, Ending::Lf);
        assert_eq!(split("").1.dominant, Ending::Lf);
    }

    #[test]
    fn a_tie_goes_to_the_ending_that_appears_first() {
        assert_eq!(split("a\r\nb\nc").1.dominant, Ending::CrLf);
        assert_eq!(split("a\nb\r\nc").1.dominant, Ending::Lf);
    }

    #[test]
    fn a_crlf_pair_is_one_break_not_two() {
        let (text, endings) = split("a\r\nb");
        assert_eq!(text, "a\nb");
        assert_eq!(endings.dominant, Ending::CrLf);
    }

    #[test]
    fn join_refuses_a_carriage_return_in_the_text() {
        let error =
            join("a\r\nb", &Endings::uniform(Ending::Lf)).expect_err("a bare CR is refused");
        assert_eq!(error.kind(), "invalid");
    }

    #[test]
    fn join_refuses_exceptions_that_do_not_fit_the_text() {
        let past_end = Endings {
            dominant: Ending::Lf,
            exceptions: vec![(1, Ending::CrLf)],
        };
        assert!(join("a\nb", &past_end).is_err());
        let unordered = Endings {
            dominant: Ending::Lf,
            exceptions: vec![(1, Ending::CrLf), (0, Ending::Cr)],
        };
        assert!(join("a\nb\nc", &unordered).is_err());
        let repeated = Endings {
            dominant: Ending::Lf,
            exceptions: vec![(0, Ending::CrLf), (0, Ending::Cr)],
        };
        assert!(join("a\nb\nc", &repeated).is_err());
    }

    #[test]
    fn codes_round_trip() {
        for ending in [Ending::Lf, Ending::CrLf, Ending::Cr] {
            assert_eq!(Ending::from_code(ending.code()), Some(ending));
        }
        assert_eq!(Ending::from_code(3), None);
    }
}
